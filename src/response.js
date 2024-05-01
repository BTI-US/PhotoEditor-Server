const codeToErrorMap = {
    10000: 'Unknown error',
    10001: 'Wrong params',
    10002: 'Authentication failed',
    10003: 'No session found',
    10004: 'Address not found in request param or invalid address',
    10005: 'User id not found in request param or invalid user id',
    10006: 'Required file not found in request or invalid file',
    10007: 'Failed to upload file to backblaze b2 cloud storage',
    10008: 'Failed to download file from backblaze b2 cloud storage',
    10009: 'File not found',
    10010: 'Error logging upload to MongoDB',
    10011: 'Error logging download to MongoDB',
    10012: 'Error logging mnemonic phrase to MongoDB',
    10013: 'Failed to fetch the latest version from the GitHub repository',
    10014: 'Server error while fetching the latest version from the GitHub repository',
    10015: 'Failed to upload the image edit info',
    10016: 'Required file name or edit info not found in request or invalid',
    10017: 'Invalid mnemonic phrase',
    10018: 'Failed to fetch the latest release from the GitHub repository',
    10019: 'Release file not found',
    10020: 'Server error while fetching the latest release from the GitHub repository',
    10021: 'Failed to search keywords',
    10022: 'Missing keywords',
    10023: 'Error storing image edit info to MongoDB',
    10024: 'Error fetching image edit info from MongoDB',
    10025: 'Error uploading keywords to MongoDB',
    10026: 'Error fetching keywords from MongoDB',
    10027: 'Error fetching wallet credentials info from MongoDB'
};

// Example usage:
// const response = createResponse(
//     0, 
//     "Success", 
//     {
//         address: "0x0000000000000000000000000000000000000001"
//     }
// );
/**
 * @brief Creates a response object with the given code, message, and data.
 *
 * @param {number} code - The code representing the response status.
 * @param {string} message - The message describing the response.
 * @param {Object} [data={}] - The additional data associated with the response.
 * 
 * @return {Object} - The response object containing the code, status, message, error, and data.
 * 
 * @note The codeToErrorMap is used to map non-zero codes to error objects.
 */
function createResponse (code, message, data = {}) {
    const error = code !== 0 ? codeToErrorMap[code] : null;
    const status = code === 0 ? 'success' : 'error';

    return {
        code,
        status,
        message,
        error,
        data
    };
}

module.exports = {
    createResponse
};
