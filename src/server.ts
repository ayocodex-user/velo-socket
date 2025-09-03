import { config } from 'dotenv';
config()
import express from 'express';
import http from 'http';
import { join } from 'path';


export const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(join('../', 'public')));

export const server = http.createServer(app);
const whitelist = [process.env.ALLOWED_URL, process.env.ALLOWED_URL_1];

export const corsOptions = {
  origin: function (origin: any, callback: (arg0: Error | null, arg1: boolean | undefined) => void) {
    console.log('Request Origin:', origin);
    if (whitelist.indexOf(origin || '') !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'), false);
    }
  }, 
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
};

