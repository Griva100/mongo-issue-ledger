import mongoose from 'mongoose';

export async function connectDatabase(uri: string) {
  return mongoose.createConnection(uri, {
    autoIndex: false,
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
  }).asPromise();
}
