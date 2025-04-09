import express from 'express';
import http from 'http';


export const app = express();

export const server = http.createServer(app);
const whitelist = [process.env.ALLOWED_URL, process.env.ALLOWED_URL_1];

export const corsOptions = {
  origin: function (origin: any, callback: (arg0: Error | null, arg1: boolean | undefined) => void) {
    console.log('Request Origin:', origin);
    if (whitelist.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'), false);
    }
  }, // Allow requests from this origin 
  methods: ['GET', 'POST'], // Allowed methods
  credentials: true // Allow credentials
};

