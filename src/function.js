const fs = require('fs');
const B2 = require('backblaze-b2');
const mongoUtil = require('./db');

let dbConnection = null;

// Initialize B2 client
const b2 = new B2({
    accountId: process.env.B2_ACCOUNT_ID,
    applicationKey: process.env.B2_APPLICATION_KEY
});

mongoUtil.connectToServer()
    .then(({ dbConnection: localDbConnection }) => {
        console.log("Successfully connected to MongoDB.");

        // Create a unique index for 'userId'
        localDbConnection.collection('imageUpload').createIndex({ userId: 1 }, { unique: true })
            .then(() => console.log("Unique index created successfully on 'userId' for imageUpload"))
            .catch(err => console.error("Error creating unique index on 'userId' for imageUpload:", err));

        // Create a compound index for 'fileName' and 'createdAt' without enforcing uniqueness
        localDbConnection.collection('imageUpload').createIndex({ userId: 1, fileName: 1, createdAt: -1 }, { unique: false })
            .then(() => console.log("Index created successfully on 'fileName' and 'createdAt' for imageUpload"))
            .catch(err => console.error("Error creating index on 'fileName' and 'createdAt' for imageUpload:", err));

        localDbConnection.collection('imageDownload').createIndex({ userId: 1 }, { unique: true })
            .then(() => console.log("Unique index created successfully on 'userId' for imageDownload"))
            .catch(err => console.error("Error creating unique index on 'userId' for imageDownload:", err));
        
        localDbConnection.collection('imageDownload').createIndex({ userId: 1, fileName: 1, createdAt: -1 }, { unique: false })
            .then(() => console.log("Index created successfully on 'fileName' and 'createdAt' for imageDownload"))
            .catch(err => console.error("Error creating index on 'fileName' and 'createdAt' for imageDownload:", err));

        // Assign the database connections to the variables declared at higher scope
        dbConnection = localDbConnection;
    })
    .catch(err => {
        console.error("Failed to connect to MongoDB:", err);
    });

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
        throw error;
    }
}

/**
 * @brief Logs the upload details to MongoDB.
 * 
 * @param {string} userId - The ID of the user who uploaded the file.
 * @param {string} fileName - The name of the uploaded file.
 * 
 * @return {Promise<void>} - A promise that resolves when the upload details are logged successfully.
 * 
 * @note This function inserts a log entry into the 'imageUpload' collection in MongoDB, recording the user ID, 
 *       file name, and the current timestamp.
 */
async function logUploadDetails (userId, fileName) {
    try {
        const collection = dbConnection.collection('imageUpload');

        const logEntry = {
            userId,
            fileName,
            createdAt: new Date() // Record the current timestamp
        };

        await collection.insertOne(logEntry);
        console.log('Upload logged successfully:', logEntry);
    } catch (error) {
        console.error('Error logging upload to MongoDB:', error);
    }
}

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
        console.error('Error logging download to MongoDB:', error);
    }
}

module.exports = {
    uploadToB2,
    downloadFromB2,
    logUploadDetails,
    logDownloadDetails
};
