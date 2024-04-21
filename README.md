# PhotoEditor Backend Server

[![CodeQL](https://github.com/BTI-US/PhotoEditor-Server/actions/workflows/codeql.yml/badge.svg)](https://github.com/BTI-US/PhotoEditor-Server/actions/workflows/codeql.yml)
[![Docker CI](https://github.com/BTI-US/PhotoEditor-Server/actions/workflows/docker-ci.yml/badge.svg)](https://github.com/BTI-US/PhotoEditor-Server/actions/workflows/docker-ci.yml)
[![Deploy Worker to Cloudflare](https://github.com/BTI-US/PhotoEditor-Server/actions/workflows/worker.yml/badge.svg)](https://github.com/BTI-US/PhotoEditor-Server/actions/workflows/worker.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Introduction

This is the backend server for the PhotoEditor project. It is a RESTful API server that provides endpoints for the frontend client to interact with the database.

## Installation and Setup

### Setting Up Required Keys

1. Create a `.env` file in the root directory of the project.
2. Add the following keys to the `.env` file:

    ```env
    PRIVKEY_PATH="your_private_key_path"
    CERT_PATH="your_cert_path"
    SERVER_PORT=3000
    B2_ACCOUNT_ID="your_b2_account_id"
    B2_APPLICATION_KEY="your_b2_application_key"
    B2_BUCKET_ID="your_b2_bucket_id"
    MONGODB_USERNAME="your_mongodb_username"
    MONGODB_PASSWORD="your_mongodb_password"
    MONGODB_PORT="your_mongodb_port"
    MONGODB_DB="your_mongodb_name"
    ```

### Building the Docker Image

1. Clone the repository:
   ```bash
   git clone https://github.com/BTI-US/PhotoEditor-Server
   cd PhotoEditor-Server
   ```
2. Build the Docker image:
   ```bash
   docker build -t photoeditor-server .
   ```

### Building the MongoDB Docker Image

1. Pull the MongoDB image:
   ```bash
   docker pull mongo
   ```
2. Run the docker image with the necessary environment variables:
   ```bash
   docker run --name mongodb -d -p 27000:27000 -v /root/mongodb:/data/db -e MONGO_INITDB_ROOT_USERNAME=admin -e MONGO_INITDB_ROOT_PASSWORD=password mongo

### Running the Application

Run the Docker container using the following command:
```bash
SERVER_PORT=3000 \
MONGODB_DB=userLogs \
MONGODB_PORT=27000 \
MONGODB_USERNAME=admin \
MONGODB_PASSWORD='your_mongodb_password' \
B2_ACCOUNT_ID='your_b2_account_id' \
B2_APPLICATION_KEY='your_b2_application_key' \
B2_BUCKET_ID='your_b2_bucket_id' \
CERT_PATH=/etc/ssl/certs/fullchain2.pem \
PRIVKEY_PATH=/etc/ssl/certs/privkey2.pem \
HOST_CERT_FOLDER=/etc/letsencrypt/archive/btiplatform.com \
CONTAINER_CERT_FOLDER=/etc/ssl/certs \
docker-compose up -d
```

To remove the Docker container, run:
```bash
SERVER_PORT=3000 \
MONGODB_DB=userLogs \
MONGODB_PORT=27000 \
MONGODB_USERNAME=admin \
MONGODB_PASSWORD='your_mongodb_password' \
B2_ACCOUNT_ID='your_b2_account_id' \
B2_APPLICATION_KEY='your_b2_application_key' \
B2_BUCKET_ID='your_b2_bucket_id' \
CERT_PATH=/etc/ssl/certs/fullchain2.pem \
PRIVKEY_PATH=/etc/ssl/certs/privkey2.pem \
HOST_CERT_FOLDER=/etc/letsencrypt/archive/btiplatform.com \
CONTAINER_CERT_FOLDER=/etc/ssl/certs \
docker-compose down
```

## Milestone

- [x] Setup the project
- [x] Implement the endpoints
- [x] Add file upload to the backblaze b2 cloud
- [x] Add mongodb for storing user ID and image names
- [x] Add filter rules

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
