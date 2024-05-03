const mongoUtil = require('./db');
const {
    imageUploadSchema,
    imageDownloadSchema,
    clipboardInfoSchema,
    imageEditInfoSchema,
    keywordsSchema,
    userActivationSchema
    } = require('./dbSchema');

/**
 * @brief Removes duplicate documents from a collection based on specified fields.
 * @param {Collection} collection - The MongoDB collection to remove duplicates from.
 * @param {Object} fields - The fields to consider for identifying duplicates.
 * @return {Promise<void>} - A promise that resolves when the duplicates are removed.
 * @note This function uses the MongoDB aggregation framework to identify and remove duplicates.
 */
async function removeDuplicates (collection, fields) {
    const groupFields = Object.fromEntries(Object.keys(fields).map(key => [key, `$${key}`]));

    const duplicates = await collection.aggregate([
        { $group: { _id: groupFields, count: { $sum: 1 }, dups: { $push: "$_id" } } },
        { $match: { count: { $gt: 1 } } }
    ]).toArray();

    await Promise.all(duplicates.map(async (duplicate) => {
        duplicate.dups.shift();      // First element skipped for deleting
        await collection.deleteMany({ _id: { $in: duplicate.dups } });
    }));
}

/**
 * @brief Creates an index in a MongoDB collection based on the specified fields.
 * If an index with the same fields already exists, it will be dropped and recreated.
 *
 * @param {Collection} collection - The MongoDB collection to create the index in.
 * @param {Object} fields - The fields to create the index on.
 * @param {boolean} [unique=false] - Optional. Specifies whether the index should enforce uniqueness.
 * @return {Promise<void>} - A promise that resolves when the index is created or already exists.
 * @note This function assumes that the MongoDB collection has been properly initialized and connected.
 */
async function createIndex (collection, fields, unique = false) {
    const indexName = Object.keys(fields).join('_');
    const indexes = await collection.listIndexes().toArray();

    const existingIndex = indexes.find(index => JSON.stringify(index.key) === JSON.stringify(fields));

    if (existingIndex) {
        if (existingIndex.name !== indexName) {
            // Drop the existing index if it has a different name
            await collection.dropIndex(existingIndex.name);
        } else {
            // If the existing index has the same name, no need to create it again
            return;
        }
    }

    if (unique) {
        // Handle duplicates before creating a unique index
        await removeDuplicates(collection, fields);
    }

    return collection.createIndex(fields, { unique, name: indexName });
}

/**
 * @brief Ensures that a collection exists in the MongoDB database.
 * 
 * @param {Db} db - The MongoDB database object.
 * @param {string} collectionName - The name of the collection to ensure exists.
 * @param {Object} schema - The schema to validate the collection against.
 * 
 * @return {Promise<void>} - A promise that resolves when the collection is ensured to exist.
 * 
 * @note This function checks if a collection with the specified name exists in the MongoDB database.
 * If the collection does not exist, it creates the collection with the provided schema.
 * The function uses the MongoDB `listCollections` method to check if the collection exists.
 * If the collection does not exist, it uses the `createCollection` method to create the collection with the provided schema.
 * The function returns a promise that resolves when the collection is ensured to exist.
 */
async function ensureCollectionExists (db, collectionName, schema) {
    const collections = await db.listCollections({ name: collectionName }, { nameOnly: true }).toArray();
    if (collections.length === 0) {
        await db.createCollection(collectionName, { validator: schema });
    }
}

const dbConnectionPromise = mongoUtil.connectToServer()
    .then(async ({ dbConnection: localDbConnection }) => {
        console.log("Successfully connected to MongoDB.");

        const collections = [
            {
                name: 'imageUpload',
                schema: imageUploadSchema,
                index: { fields: { userId: 1, userAddress: 1, textJSON: 1 }, unique: true }
            },
            {
                name: 'imageDownload',
                schema: imageDownloadSchema,
                index: { fields: { userId: 1, fileName: 1 }, unique: true }
            },
            {
                name: 'clipboardInfo',
                schema: clipboardInfoSchema, 
                index: { fields: { userId: 1, userAddress: 1, userPrivateKey: -1 }, unique: true }
            },
            {
                name: 'imageEditInfo',
                schema: imageEditInfoSchema,
                index: { fields: { fileName: 1, editInfo: 1 }, unique: true }
            },
            {
                name: 'keywords',
                schema: keywordsSchema,
                index: { fields: { keywords: 1 }, unique: false }
            },
            {
                name: 'userActivation',
                schema: userActivationSchema,
                index: { fields: { userId: 1, userAddress: 1, signature: 1, expirationDate: -1 }, unique: true }
            }
        ];

        await Promise.all(collections.map(async c => {
            await ensureCollectionExists(c.db, c.name, c.schema);
            await createIndex(c.db.collection(c.name), c.index.fields, c.index.unique);
        }));
        
        console.log("Successfully created collections and indexes in MongoDB.");

        return {
            dbConnection: localDbConnection
        };
    })
    .catch(err => {
        console.error("Failed to connect to MongoDB:", err);
    });

async function getDbConnections () {
    return dbConnectionPromise;
}

module.exports = {
    getDbConnections
};
