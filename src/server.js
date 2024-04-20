const express = require('express');
const multer = require('multer');
const path = require('path');
const B2 = require('backblaze-b2');
const https = require('https');
const fs = require('fs');

if (!process.env.DOCKER_ENV) {
    require('dotenv').config();
}

if (!process.env.B2_BUCKET_ID || !process.env.B2_ACCOUNT_ID || !process.env.B2_APPLICATION_KEY) {
    console.error('Please provide B2_BUCKET_ID, B2_ACCOUNT_ID and B2_APPLICATION_KEY in the environment variables.');
    process.exit(1);
}

const app = express();
// Initialize B2 client
const b2 = new B2({
    accountId: process.env.B2_ACCOUNT_ID,
    applicationKey: process.env.B2_APPLICATION_KEY,
});

// Configure multer for file storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

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

// Endpoint to handle POST requests for file uploads
app.post('/upload', upload.single('image'), async (req, res) => {
    const userId = req.body.userId; // Retrieve the userId from form data
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    try {
        // Path and name of the file saved locally
        const localFilePath = req.file.path;
        const localFileName = req.file.filename;

        // Upload to Backblaze B2
        const b2Response = await uploadToB2(localFilePath, localFileName);

        // Send success response
        res.send({
            status: 'success',
            userId: userId, // Include the userId in the response for confirmation
            localFile: localFileName,
            b2FileId: b2Response.fileId,
            b2FileName: b2Response.fileName,
            message: 'File uploaded successfully to local and Backblaze B2!'
        });
    } catch (error) {
        res.status(500).send('Error uploading to Backblaze B2: ' + error.message);
    }
});

const SERVER_PORT = process.env.SERVER_PORT || 3000;
const keyPath = process.env.PRIVKEY_PATH;
const certPath = process.env.CERT_PATH;

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('Required certificate files not found. Exiting...');
    process.exit(1);
}

https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
}, app)
.listen(SERVER_PORT, () => {
    console.log(`Listening on port ${SERVER_PORT}!`);
});

