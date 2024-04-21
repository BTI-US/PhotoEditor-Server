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
            .then(() => console.log("Unique index created successfully on 'userId'"))
            .catch(err => console.error("Error creating unique index on 'userId':", err));

        // Create a compound index for 'fileName' and 'createdAt' without enforcing uniqueness
        localDbConnection.collection('imageUpload').createIndex({ userId: 1, fileName: 1, createdAt: -1 }, { unique: false })
            .then(() => console.log("Index created successfully on 'fileName' and 'createdAt'"))
            .catch(err => console.error("Error creating index on 'fileName' and 'createdAt':", err));

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
        const userFolderPath = `user_${userId}/`; // Prefix with user_ to avoid potential naming conflicts
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

module.exports = {
    uploadToB2,
    logUploadDetails
};
