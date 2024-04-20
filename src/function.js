const mongoUtil = require('./db');

let dbConnection = null;

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
async function authenticateB2() {
    try {
        await b2.authorize();
    } catch (error) {
        console.error('B2 Authorization error:', error);
        throw error;
    }
}

// Upload file to B2
async function uploadToB2(filePath, fileName) {
    try {
        await authenticateB2();
        const uploadUrl = await b2.getUploadUrl({
            bucketId: process.env.B2_BUCKET_ID
        });

        const response = await b2.uploadFile({
            uploadUrl: uploadUrl.data.uploadUrl,
            uploadAuthToken: uploadUrl.data.authorizationToken,
            filename: fileName,
            data: Buffer.from(require('fs').readFileSync(filePath))
        });

        return response.data;
    } catch (error) {
        console.error('B2 upload error:', error);
        throw error;
    }
}

async function logUploadDetails(userId, fileName) {
    try {
        const collection = dbConnection.collection('imageUpload');

        const logEntry = {
            userId: userId,
            fileName: fileName,
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