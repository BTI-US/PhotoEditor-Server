const express = require('express');
const multer = require('multer');
const path = require('path');
const https = require('https');
const fs = require('fs');
const utils = require('./function');

if (!process.env.DOCKER_ENV) {
    require('dotenv').config();
}

if (!process.env.B2_BUCKET_ID || !process.env.B2_ACCOUNT_ID || !process.env.B2_APPLICATION_KEY) {
    console.error('Please provide B2_BUCKET_ID, B2_ACCOUNT_ID and B2_APPLICATION_KEY in the environment variables.');
    process.exit(1);
}

const app = express();
// Ensure that bodyParser is able to handle form-data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Helper function to ensure directory exists
function ensureDirSync (dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Configure multer for file storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const userId = req.body.userId; // Ensure you get userId from your form data or route parameters
        const userDir = `uploads/user_${userId}`;
        ensureDirSync(userDir); // Make sure the directory exists
        cb(null, userDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

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
        const b2Response = await utils.uploadToB2(localFilePath, localFileName, userId);

        // Log the upload details in MongoDB
        await utils.logUploadDetails(userId, localFileName);

        // Send success response
        res.send({
            status: 'success',
            userId, // Include the userId in the response for confirmation
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
    cert: fs.readFileSync(certPath)
}, app)
.listen(SERVER_PORT, () => {
    console.log(`Listening on port ${SERVER_PORT}!`);
});
