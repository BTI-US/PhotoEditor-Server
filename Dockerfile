# Use an official Node runtime as a parent image
FROM node:20

# Update npm
RUN npm install -g npm@10.5.0

# Define build arguments
ARG DOCKER_ENV="true"

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install any dependencies
RUN npm install

# Copy local code to the container image.
COPY src/ .

# Run the web service on container startup
CMD [ "node", "server.js" ]
