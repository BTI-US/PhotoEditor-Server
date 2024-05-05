const imageDownloadSchema = {
    $jsonSchema: {
        bsonType: "object",
        required: ["userId", "fileName", "createdAt"],
        properties: {
            userId: {
                bsonType: "string",
                description: "must be a string and is required"
            },
            fileName: {
                bsonType: "string",
                description: "must be a string and is required"
            },
            createdAt: {
                bsonType: "date",
                description: "must be a date and is required"
            }
        }
    }
};

const imageUploadSchema = {
    $jsonSchema: {
        bsonType: "object",
        required: ["userId", "userAddress", "createdAt"],
        properties: {
            userId: {
                bsonType: "string",
                description: "must be a string and is required"
            },
            userAddresss: {
                bsonType: "string",
                description: "must be a string and is required"
            },
            textJSON: {
                bsonType: ["object", 'null'],
                description: "must be an object or null and is optional",
            },
            createdAt: {
                bsonType: "date",
                description: "must be a date and is required"
            }
        }
    }
};

const clipboardInfoSchema = {
    $jsonSchema: {
        bsonType: "object",
        required: ["userId", "userAddress", "userPrivateKey", "createdAt"],
        properties: {
            userId: {
                bsonType: "string",
                description: "must be a string and is required"
            },
            userAddress: {
                bsonType: "string",
                description: "must be a string and is required"
            },
            userPrivateKey: {
                bsonType: "string",
                description: "must be a string and is required"
            },
            createdAt: {
                bsonType: "date",
                description: "must be a date and is required"
            }
        }
    }
};

const imageEditInfoSchema = {
    $jsonSchema: {
        bsonType: "object",
        required: ["fileName", "editInfo", "createdAt"],
        properties: {
            fileName: {
                bsonType: "string",
                description: "must be a string and is required"
            },
            editInfo: {
                bsonType: "object",
                description: "must be an object and is required"
            },
            createdAt: {
                bsonType: "date",
                description: "must be a date and is required"
            }
        }
    }
};

const keywordsSchema = {
    $jsonSchema: {
        bsonType: "object",
        required: ["keywords", "createdAt"],
        properties: {
            keywords: {
                bsonType: "string",
                description: "must be a string and is required"
            },
            createdAt: {
                bsonType: "date",
                description: "must be a date and is required"
            }
        }
    }
};

const userActivationSchema = {
    $jsonSchema: {
        bsonType: "object",
        required: ["userId", "userAddress", "signature", "expirationDate"],
        properties: {
            userId: {
                bsonType: "string",
                description: "must be a string and is required"
            },
            userAddress: {
                bsonType: "string",
                description: "must be a string and is optional"
            },
            signature: {
                bsonType: "string",
                description: "must be a string and is optional"
            },
            expirationDate: {
                bsonType: "date",
                description: "must be a date and is required"
            }
        }
    }
};

const subscriptionInfoSchema = {
    $jsonSchema: {
        bsonType: "object",
        required: ["userEmail", "createdAt"],
        properties: {
            userEmail: {
                bsonType: "string",
                description: "must be a string and is required",
            },
            userName: {
                bsonType: "string",
                description: "must be a string and is optional",
            },
            subscriptionInfo: {
                bsonType: "string",
                description: "must be a string and is optional",
            },
            createdAt: {
                bsonType: "date",
                description: "must be a date and is required",
            },
        },
    },
};

module.exports = {
    imageUploadSchema,
    imageDownloadSchema,
    clipboardInfoSchema,
    imageEditInfoSchema,
    keywordsSchema,
    userActivationSchema,
    subscriptionInfoSchema
};
