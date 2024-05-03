# Use an official Node runtime as a parent image
FROM node:20

# Update npm
RUN npm install -g npm@10.5.0

# Define build arguments
ARG DOCKER_ENV="true"
ARG PRIVKEY_PATH
ARG CERT_PATH
ARG SERVER_PORT
ARG MONGODB_DB
ARG MONGODB_PORT
ARG MONGODB_USERNAME
ARG MONGODB_PASSWORD
ARG B2_ACCOUNT_ID
ARG B2_APPLICATION_KEY
ARG B2_BUCKET_ID
ARG MONGODB_HOST="mongodb"
ARG ENCRYPTION_KEY
ARG GITHUB_OWNER="BTI-US"
ARG GITHUB_REPO="PhotoEditor"
ARG GITHUB_TOKEN
ARG RELEASE_NAME="release.apk"
ARG INFURA_PROJECT_ID
ARG CONTRACT_ADDRESS
ARG ETHEREUM_NETWORK
ARG EXPIRATION_TIME_PERIOD
ARG MIN_TOKEN_AMOUNT
ARG REDIS_HOST="redis"
ARG REDIS_PORT

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install any dependencies
RUN npm install

# Copy local code to the container image.
COPY src/ .

# Run the web service on container startup
CMD [ "node", "start.js" ]
