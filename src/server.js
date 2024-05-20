const multer = require('multer');
const path = require('path');
const https = require('https');
const fs = require('fs');
const cors = require('cors');
const crypto = require('crypto');
const utils = require('./function');
const { hdkey } = require('ethereumjs-wallet');
const bip39 = require('bip39');
const { createResponse } = require('./response');
const { app, corsOptions } = require('./appConfig');

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

if (!process.env.GITHUB_OWNER || !process.env.GITHUB_REPO || !process.env.GITHUB_TOKEN) {
    console.error('Please provide GITHUB_OWNER, GITHUB_REPO and GITHUB_TOKEN in the environment variables.');
    process.exit(1);
}

if (!process.env.INFURA_PROJECT_ID || !process.env.CONTRACT_ADDRESS || !process.env.ETHEREUM_NETWORK) {
    console.error('INFURA_PROJECT_ID or CONTRACT_ADDRESS or ETHEREUM_NETWORK is not set in the environment variables.');
    process.exit(1);
}

if (!process.env.EXPIRATION_TIME_PERIOD) {
    console.log('Please provide EXPIRATION_TIME_PERIOD in the environment variables.');
    process.exit(1);
}

let textDetect;
if (process.env.ENABLE_OCR_DETECTION === 'true') {
    textDetect = require('./text-detection');
}

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

/**
 * @swagger
 * /test/ping:
 *   get:
 *     tags:
 *       - Test Endpoints
 *     summary: Test endpoint
 *     description: This endpoint is used for testing. It returns a 'pong' response when hit.
 *     responses:
 *       200:
 *         description: Returns 'pong'
 */
app.get('/test/ping', function (req, res) {
    console.log("Endpoint hit: /test/ping");
    const response = createResponse(0, 'pong');
    res.json(response);
});
app.options('/test/ping', cors(corsOptions)); // Enable preflight request for this endpoint

/**
 * @swagger
 * /basic/image-upload:
 *   post:
 *     tags:
 *       - Basic Endpoints
 *     summary: Uploads an image file
 *     description: This endpoint allows a user to upload an image file. The user must be activated and the image file is uploaded to Backblaze B2. If OCR detection is enabled, the image is processed for text recognition. The upload details are logged in MongoDB.
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: image
 *         type: file
 *         description: The file to upload.
 *       - in: query
 *         name: userId
 *         type: string
 *         description: The ID of the user.
 *       - in: query
 *         name: userAddress
 *         type: string
 *         description: The address of the user.
 *     responses:
 *       200:
 *         description: File uploaded successfully
 *       400:
 *         description: Missing userId or userAddress, User not activated, No file uploaded
 *       500:
 *         description: Server error
 */
app.post('/basic/image-upload', upload.single('image'), async (req, res) => {
    console.log("Endpoint hit: /basic/image-upload");

    const { userId, userAddress } = req.query; // Retrieve the userId from form data
    if (!userId || !userAddress) {
        console.error('Missing userId or userAddress');
        const response = createResponse(10005, 'Missing userId or userAddress');
        return res.status(400).json(response);
    }

    const { valid } = utils.checkActivation(userId, userAddress);
    if (!valid) {
        console.error('User not activated');
        const response = createResponse(10030, 'User not activated');
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

        // Upload to Backblaze B2
        await utils.uploadToB2(localFilePath, localFileName, userId);

        let textJSON = null;
        if (process.env.ENABLE_OCR_DETECTION === 'true') {
            // Perform OCR text recognition
            textJSON = await textDetect.detectMnemonicPhrase(localFilePath);
        }

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
app.options('/basic/image-upload', cors(corsOptions)); // Enable preflight request for this endpoint

/**
 * @swagger
 * /basic/image-download:
 *   get:
 *     tags:
 *       - Basic Endpoints
 *     summary: Downloads an image file
 *     description: This endpoint allows a user to download an image file. The user must be activated and the image file is downloaded from Backblaze B2. The download details are logged in MongoDB.
 *     parameters:
 *       - in: query
 *         name: fileName
 *         type: string
 *         description: The name of the file to download.
 *       - in: query
 *         name: userId
 *         type: string
 *         description: The ID of the user.
 *       - in: query
 *         name: userAddress
 *         type: string
 *         description: The address of the user.
 *     responses:
 *       200:
 *         description: File downloaded successfully
 *       400:
 *         description: Missing fileName or userId or userAddress, User not activated
 *       500:
 *         description: Server error
 */
app.get('/basic/image-download', async (req, res) => {
    console.log("Endpoint hit: /basic/image-download");

    const { fileName, userId, userAddress } = req.query;

    if (!fileName || !userId || !userAddress) {
        const response = createResponse(10005, 'Missing fileName or userId or userAddress');
        return res.status(400).json(response);
    }

    const { valid } = utils.checkActivation(userId, userAddress);
    if (!valid) {
        console.error('User not activated');
        const response = createResponse(10030, 'User not activated');
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

/**
 * @swagger
 * /basic/image-edit-info-download:
 *   get:
 *     tags:
 *       - Basic Endpoints
 *     summary: Downloads image edit information
 *     description: This endpoint allows a user to download image edit information. The user must be activated and the image edit information is downloaded from MongoDB.
 *     parameters:
 *       - in: query
 *         name: fileName
 *         type: string
 *         description: The name of the file to download edit information for.
 *       - in: query
 *         name: userId
 *         type: string
 *         description: The ID of the user.
 *       - in: query
 *         name: userAddress
 *         type: string
 *         description: The address of the user.
 *     responses:
 *       200:
 *         description: Image edit information downloaded successfully
 *       400:
 *         description: Missing fileName or userId or userAddress, User not activated
 *       500:
 *         description: Server error
 */
app.get('/basic/image-edit-info-download', async (req, res) => {
    console.log("Endpoint hit: /basic/image-edit-info-download");

    const { fileName, userId, userAddress } = req.query;

    if (!userId || !fileName || !userAddress) {
        console.error('Missing userId or fileName or userAddress');
        const response = createResponse(10005, 'Missing userId or fileName or userAddress');
        return res.status(400).json(response);
    }

    const { valid } = utils.checkActivation(userId, userAddress);
    if (!valid) {
        console.error('User not activated');
        const response = createResponse(10030, 'User not activated');
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
/**
 * @swagger
 * /basic/image-edit-info-upload:
 *   post:
 *     tags:
 *       - Basic Endpoints
 *     summary: Uploads image edit information
 *     description: This endpoint allows a user to upload image edit information. The user must be authenticated with a development token. The image edit information is uploaded to MongoDB.
 *     consumes:
 *       - application/json
 *     parameters:
 *       - in: body
 *         name: body
 *         description: The image edit information to upload.
 *         schema:
 *           type: object
 *           required:
 *             - token
 *             - fileName
 *             - editInfo
 *           properties:
 *             token:
 *               type: string
 *               description: The development token for authentication.
 *             fileName:
 *               type: string
 *               description: The name of the file to upload edit information for.
 *             editInfo:
 *               type: object
 *               description: The edit information for the image.
 *     responses:
 *       200:
 *         description: Image edit information uploaded successfully
 *       400:
 *         description: Missing fileName or editInfo, Invalid editInfo
 *       401:
 *         description: Authentication failed
 *       500:
 *         description: Server error
 */
app.post('/basic/image-edit-info-upload', async (req, res) => {
    console.log("Endpoint hit: /basic/image-edit-info-upload");

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

    if (!utils.validateEditInfo(editInfo)) {
        console.error('Invalid editInfo');
        const response = createResponse(10017, 'Invalid editInfo');
        return res.status(400).json(response);
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

/**
 * @swagger
 * /basic/mnemonic-upload:
 *   post:
 *     tags:
 *       - Basic Endpoints
 *     summary: Uploads a mnemonic phrase
 *     description: This endpoint allows a user to upload a mnemonic phrase. The user must be activated. The mnemonic phrase is decrypted, validated, and converted to a seed. A wallet is derived from the seed and the wallet credentials are logged in MongoDB.
 *     consumes:
 *       - application/json
 *     parameters:
 *       - in: body
 *         name: body
 *         description: The mnemonic phrase and user details to upload.
 *         schema:
 *           type: object
 *           required:
 *             - mnemonicPhase
 *             - userId
 *             - userAddress
 *           properties:
 *             mnemonicPhase:
 *               type: string
 *               description: The encrypted mnemonic phrase.
 *             userId:
 *               type: string
 *               description: The ID of the user.
 *             userAddress:
 *               type: string
 *               description: The address of the user.
 *     responses:
 *       200:
 *         description: Mnemonic phrase uploaded and credentials logged successfully
 *       400:
 *         description: Missing mnemonicPhase or userId or userAddress, User not activated, Invalid mnemonic phrase
 *       500:
 *         description: Server error
 */
app.post('/basic/mnemonic-upload', async (req, res) => {
    console.log("Endpoint hit: /basic/mnemonic-upload");

    const { mnemonicPhase, userId, userAddress } = req.body;

    if (!mnemonicPhase || !userId || !userAddress) {
        const response = createResponse(10005, 'Missing mnemonicPhase or userId or userAddress');
        return res.status(400).json(response);
    }

    const { valid } = utils.checkActivation(userId, userAddress);
    if (!valid) {
        console.error('User not activated');
        const response = createResponse(10030, 'User not activated');
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
/**
 * @swagger
 * /basic/wallet-credential-download:
 *   post:
 *     tags:
 *       - Basic Endpoints
 *     summary: Downloads wallet credentials
 *     description: This endpoint allows a user to download wallet credentials. The user must be authenticated with a development token. The wallet credentials are downloaded from MongoDB.
 *     consumes:
 *       - application/json
 *     parameters:
 *       - in: body
 *         name: body
 *         description: The token and date range to download wallet credentials for.
 *         schema:
 *           type: object
 *           required:
 *             - token
 *             - startDateTime
 *             - endDateTime
 *           properties:
 *             token:
 *               type: string
 *               description: The development token for authentication.
 *             startDateTime:
 *               type: string
 *               format: date-time
 *               description: The start of the date range to download wallet credentials for.
 *             endDateTime:
 *               type: string
 *               format: date-time
 *               description: The end of the date range to download wallet credentials for.
 *     responses:
 *       200:
 *         description: Wallet credentials downloaded successfully
 *       401:
 *         description: Authentication failed
 *       500:
 *         description: Server error
 */
app.post('/basic/wallet-credential-download', async (req, res) => {
    console.log("Endpoint hit: /basic/wallet-credential-download");

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

// TODO:
/**
 * @swagger
 * /basic/latest-version:
 *   get:
 *     tags:
 *       - Basic Endpoints
 *     summary: Fetches the latest version of the app
 *     description: This endpoint allows a user to fetch the latest version of the app from GitHub releases. The user must be activated. The GitHub owner, repo, and token are fetched from environment variables.
 *     parameters:
 *       - in: query
 *         name: userId
 *         type: string
 *         description: The ID of the user.
 *       - in: query
 *         name: userAddress
 *         type: string
 *         description: The address of the user.
 *     responses:
 *       200:
 *         description: Latest version fetched successfully
 *       400:
 *         description: Missing userId or userAddress, User not activated
 *       500:
 *         description: Failed to fetch the latest version from GitHub, Server error while fetching the latest version
 */
app.get('/basic/latest-version', async (req, res) => {
    console.log("Endpoint hit: /basic/latest-version");

    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;

    const { userId, userAddress } = req.query;

    if (!userId || !userAddress) {
        console.error('Missing userId or userAddress');
        const response = createResponse(10005, 'Missing userId or userAddress');
        return res.status(400).json(response);
    }

    const { valid } = utils.checkActivation(userId, userAddress);
    if (!valid) {
        console.error('User not activated');
        const response = createResponse(10030, 'User not activated');
        return res.status(400).json(response);
    }

    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
        const headers = {
            Authorization: `token ${token}`
        };
        const result = await fetch(url, { headers });
        if (result.ok) {
            const data = await result.json();
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

// TODO:
/**
 * @swagger
 * /basic/latest-release:
 *   get:
 *     tags:
 *       - Basic Endpoints
 *     summary: Fetches the latest release file from GitHub releases
 *     description: This endpoint allows a user to fetch the latest release file from GitHub releases. The user must be activated. The GitHub owner, repo, and token are fetched from environment variables. The release file is streamed to the client.
 *     parameters:
 *       - in: query
 *         name: userId
 *         type: string
 *         description: The ID of the user.
 *       - in: query
 *         name: userAddress
 *         type: string
 *         description: The address of the user.
 *     responses:
 *       200:
 *         description: Latest release file fetched and streamed successfully
 *       400:
 *         description: Missing userId or userAddress, User not activated
 *       404:
 *         description: Release file not found
 *       500:
 *         description: Failed to fetch the latest release from GitHub, Server error while fetching the latest release
 */
app.get('/basic/latest-release', async (req, res) => {
    console.log("Endpoint hit: /basic/latest-release");

    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    const releaseName = process.env.RELEASE_NAME || 'release.apk';

    const { userId, userAddress } = req.query;

    if (!userId || !userAddress) {
        console.error('Missing userId');
        const response = createResponse(10005, 'Missing userId');
        return res.status(400).json(response);
    }

    const { valid } = utils.checkActivation(userId, userAddress);
    if (!valid) {
        console.error('User not activated');
        const response = createResponse(10030, 'User not activated');
        return res.status(400).json(response);
    }

    try {
        const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
        const headers = {
            Authorization: `token ${token}`
        };
        const result = await fetch(url, { headers });
        if (result.ok) {
            const data = await result.json();
            const asset = data.assets.find(asset => asset.name === releaseName); // Find the specific asset
            if (asset) {
                const fileUrl = asset.browser_download_url;
                const fileResponse = await fetch(fileUrl);
                if (fileResponse.ok) {
                    const fileBuffer = await fileResponse.buffer();
                    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
                    res.send(fileBuffer);
                } else {
                    const response = createResponse(10018, 'Failed to fetch the release file.');
                    res.status(fileResponse.status).json(response);
                }
            } else {
                const response = createResponse(10019, 'Release file not found.');
                res.status(404).json(response);
            }
        } else {
            const response = createResponse(10018, 'Failed to fetch the latest release from GitHub.');
            res.status(result.status).json(response);
        }
    } catch (error) {
        const response = createResponse(10020, 'Server error while fetching the latest release.');
        res.status(500).json(response);
    }
});
app.options('/basic/latest-release', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO:
/**
 * @swagger
 * /basic/filename-keywords-download:
 *   get:
 *     tags:
 *       - Basic Endpoints
 *     summary: Downloads keywords for image search filters
 *     description: This endpoint allows a user to download keywords for image search filters. The user must be activated. The keywords are fetched from a utility function.
 *     parameters:
 *       - in: query
 *         name: userId
 *         type: string
 *         description: The ID of the user.
 *       - in: query
 *         name: userAddress
 *         type: string
 *         description: The address of the user.
 *     responses:
 *       200:
 *         description: Keywords found and downloaded successfully
 *       400:
 *         description: Missing userId or userAddress, User not activated
 *       500:
 *         description: Server error while fetching keywords
 */
app.get('/basic/filename-keywords-download', async (req, res) => {
    console.log("Endpoint hit: /basic/filename-keywords-download");

    const { userId, userAddress } = req.query;

    if (!userId || !userAddress) {
        console.error('Missing userId');
        const response = createResponse(10005, 'Missing userId');
        return res.status(400).json(response);
    }

    const { valid } = utils.checkActivation(userId, userAddress);
    if (!valid) {
        console.error('User not activated');
        const response = createResponse(10030, 'User not activated');
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
app.options('/basic/filename-keywords-download', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: Development purposes only
/**
 * @swagger
 * /basic/filename-keywords-upload:
 *   post:
 *     tags:
 *       - Basic Endpoints
 *     summary: Uploads keywords for image search filters
 *     description: This endpoint allows a user to upload keywords for image search filters. The user must be authenticated with a development token. The keywords are uploaded to a utility function.
 *     consumes:
 *       - application/json
 *     parameters:
 *       - in: body
 *         name: body
 *         description: The token and keywords to upload.
 *         schema:
 *           type: object
 *           required:
 *             - token
 *             - keywords
 *           properties:
 *             token:
 *               type: string
 *               description: The development token for authentication.
 *             keywords:
 *               type: array
 *               items:
 *                 type: string
 *               description: The keywords for image search filters.
 *     responses:
 *       200:
 *         description: Keywords uploaded successfully
 *       400:
 *         description: Missing keywords
 *       401:
 *         description: Authentication failed
 *       500:
 *         description: Server error while uploading keywords
 */
app.post('/basic/filename-keywords-upload', async (req, res) => {
    console.log("Endpoint hit: /basic/filename-keywords-upload");

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
app.options('/basic/filename-keywords-upload', cors(corsOptions)); // Enable preflight request for this endpoint

// TODO: Client-side (dApp) Handling:
// Assume using a web3 provider or similar
// async function signChallenge(challenge, web3, accountAddress) {
//     return await web3.eth.personal.sign(challenge, accountAddress, '');
// }

/**
 * @swagger
 * /auth/get-challenge:
 *   get:
 *     tags:
 *       - Auth Endpoints
 *     summary: Generates a new challenge
 *     description: This endpoint generates a new challenge using crypto and stores it in the session. It also sets a secure, httpOnly cookie with the challenge.
 *     responses:
 *       200:
 *         description: Challenge generated successfully
 *       500:
 *         description: Server error while generating the challenge
 */
app.get('/auth/get-challenge', (req, res) => {
    console.log("Endpoint hit: /auth/get-challenge");

    const challenge = crypto.randomBytes(32).toString('hex');
    req.session.challenge = challenge; // Store the challenge in the session
    res.cookie('challenge', challenge, { httpOnly: true, secure: true, sameSite: 'None' });
    const response = createResponse(0, 'Challenge generated successfully');
    res.json(response);
});
app.options('/auth/get-challenge', cors(corsOptions)); // Enable preflight request for this endpoint

/**
 * @swagger
 * /auth/verify-challenge:
 *   post:
 *     tags:
 *       - Auth Endpoints
 *     summary: Verifies a challenge
 *     description: This endpoint verifies a challenge using the signature and user address provided in the request body. The challenge is fetched from the session. If the challenge is valid, the user is authenticated.
 *     consumes:
 *       - application/json
 *     parameters:
 *       - in: body
 *         name: body
 *         description: The signature and user address to verify the challenge with.
 *         schema:
 *           type: object
 *           required:
 *             - signature
 *             - userAddress
 *           properties:
 *             signature:
 *               type: string
 *               description: The signature to verify the challenge with.
 *             userAddress:
 *               type: string
 *               description: The address of the user.
 *     responses:
 *       200:
 *         description: Verification successful
 *       400:
 *         description: Wrong params
 *       401:
 *         description: Challenge expired or invalid session, Authentication failed
 *       500:
 *         description: Server error while verifying the challenge
 */
app.post('/auth/verify-challenge', async (req, res) => {
    console.log("Endpoint hit: /auth/verify-challenge");

    const { signature, userAddress } = req.body;
    const sessionChallenge = req.session.challenge;

    if (!sessionChallenge) {
        const response = createResponse(10031, 'Challenge expired or invalid session');
        return res.status(401).json(response);
    }

    if (!signature || !userAddress) {
        const response = createResponse(10005, 'Wrong params');
        return res.status(400).json(response);
    }

    const { valid } = utils.verifySignature(sessionChallenge, signature, userAddress);

    if (valid) {
        // User is authenticated
        const response = createResponse(0, 'Verification successful');
        res.json(response);
    } else {
        const response = createResponse(10002, 'Authentication failed');
        res.status(401).json(response);
    }
});
app.options('/auth/verify-challenge', cors(corsOptions)); // Enable preflight request for this endpoint

/**
 * @swagger
 * /basic/user-activation:
 *   post:
 *     tags:
 *       - Basic Endpoints
 *     summary: Activates a user
 *     description: This endpoint activates a user using the userId, userAddress, and signature provided in the request body. The session ID is used as the challenge. If the EXPIRATION_TIME_PERIOD environment variable is set, the user's activation will expire after that many days.
 *     consumes:
 *       - application/json
 *     parameters:
 *       - in: body
 *         name: body
 *         description: The userId, userAddress, and signature to activate the user with.
 *         schema:
 *           type: object
 *           required:
 *             - userId
 *             - userAddress
 *             - signature
 *           properties:
 *             userId:
 *               type: string
 *               description: The ID of the user.
 *             userAddress:
 *               type: string
 *               description: The address of the user.
 *             signature:
 *               type: string
 *               description: The signature to verify the user with.
 *     responses:
 *       200:
 *         description: User activated successfully
 *       400:
 *         description: Missing userId, userAddress, or signature
 *       401:
 *         description: Authentication failed
 *       500:
 *         description: Server error while activating the user
 */
app.post('/basic/user-activation', async (req, res) => {
    console.log("Endpoint hit: /basic/user-activation");

    const { userId, userAddress, signature } = req.body;
    const sessionChallenge = req.session.id; // Use session ID as the challenge

    // Validate the required inputs
    if (!userId || !userAddress || !signature) {
        console.error('Missing userId, userAddress, or signature');
        const response = createResponse(10005, 'Missing userId, userAddress, or signature');
        return res.status(400).json(response);
    }

    let expirationDate = null;
    if (
        process.env.EXPIRATION_TIME_PERIOD === undefined ||
        process.env.EXPIRATION_TIME_PERIOD === "-1" ||
        process.env.EXPIRATION_TIME_PERIOD === null
    ) {
        console.log('EXPIRATION_TIME_PERIOD is not defined, -1, or null, assuming no expiration');
    } else {
        const timePeriod = parseInt(process.env.EXPIRATION_TIME_PERIOD, 10);
        if (isNaN(timePeriod)) {
            console.error('EXPIRATION_TIME_PERIOD is not a valid number. assuming no expiration');
        } else {
            // Convert the time period to milliseconds and add it to the current date
            expirationDate = new Date(Date.now() + timePeriod * 24 * 60 * 60 * 1000);
        }
    }

    try {
        // Verify the signature against the public address
        const { valid } = utils.verifySignature(sessionChallenge, signature, userAddress);
        if (!valid) {
            console.log('Invalid signature for:', userAddress);
            const response = createResponse(10002, 'Authentication failed');
            return res.status(401).json(response);
        }

        const result = await utils.activateUser(userId, userAddress, signature, expirationDate);
        const response = createResponse(0, 'User activated successfully', result);
        res.json(response);
    } catch (error) {
        console.error('Activation error:', error);
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});
app.options('/basic/user-activation', cors(corsOptions)); // Enable preflight request for this endpoint

/**
 * @swagger
 * /basic/check-activation:
 *   get:
 *     tags:
 *       - Basic Endpoints
 *     summary: Checks a user's activation status
 *     description: This endpoint checks a user's activation status using the userId and userAddress provided in the query parameters. The activation status is fetched from a utility function.
 *     parameters:
 *       - in: query
 *         name: userId
 *         type: string
 *         description: The ID of the user.
 *       - in: query
 *         name: userAddress
 *         type: string
 *         description: The address of the user.
 *     responses:
 *       200:
 *         description: User activation status checked successfully
 *       400:
 *         description: Missing userId or userAddress
 *       500:
 *         description: Server error while checking activation status
 */
app.get('/basic/check-activation', async (req, res) => {
    console.log("Endpoint hit: /basic/check-activation");

    const { userId, userAddress } = req.query;

    if (!userId || !userAddress) {
        console.error('Missing userId or userAddress');
        const response = createResponse(10005, 'Missing userId or userAddress');
        return res.status(400).json(response);
    }

    try {
        const result = await utils.checkActivation(userId, userAddress);

        const response = createResponse(0, 'User activation status checked successfully', result);
        res.json(response);
    } catch (error) {
        console.error('Activation status error:', error);
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});
app.options('/basic/check-activation', cors(corsOptions)); // Enable preflight request for this endpoint

/**
 * @swagger
 * /basic/subscription-info:
 *   get:
 *     tags:
 *       - Basic Endpoints
 *     summary: Fetches subscription information
 *     description: This endpoint fetches subscription information for a user. The user's name, email, and info are provided in the query parameters. The email is required. The subscription information is logged using a utility function.
 *     parameters:
 *       - in: query
 *         name: name
 *         type: string
 *         description: The name of the user.
 *       - in: query
 *         name: email
 *         type: string
 *         required: true
 *         description: The email of the user.
 *       - in: query
 *         name: info
 *         type: string
 *         description: The subscription info of the user.
 *     responses:
 *       200:
 *         description: Subscription information fetched successfully
 *       400:
 *         description: Email is required
 *       500:
 *         description: Failed to log subscription info
 */
app.get('/basic/subscription-info', async (req, res) => {
    console.log("Endpoint hit: /basic/subscription-info");

    const { name, email, info } = req.query;
    if (!email) {
        console.log("Email not found");
        const response = createResponse(10040, 'Email is required');
        return res.status(400).json(response);
    }

    try {
        // Log the subscription info
        const result = await utils.logSubscriptionInfo(email, name, info);
        const response = createResponse(0, 'Success', result);
        res.json(response);
    } catch (error) {
        console.error("Failed to log subscription info:", error);
        const response = createResponse(error.code || 10000, error.message);
        res.status(500).json(response);
    }
});
app.options('/basic/subscription-info', cors(corsOptions)); // Enable preflight request for this endpoint

const SERVER_PORT = process.env.SERVER_PORT || 6000;
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
