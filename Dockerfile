FROM node:20-alpine

# ffmpeg-static includes its own ffmpeg binary — no system install needed
WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY server.js ./
# Your background image must be in the same folder as this Dockerfile
COPY BACK1.jpg ./

EXPOSE 3000
CMD ["node", "server.js"]
