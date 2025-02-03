import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';
import multerS3 from 'multer-s3';

// Initialize the S3 client
const s3Client = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESSKEY || '',
    secretAccessKey: process.env.AWS_SECRETKEY || '',
  },
});

// Function to upload a file to S3
export async function uploadFileToS3(BUCKET_NAME: string, file: Buffer, fileName: string, contentType: string) {
  const params = {
    Bucket: BUCKET_NAME,
    Key: fileName,
    Body: file,
    ContentType: contentType,
  };

  const command = new PutObjectCommand(params);
  await s3Client.send(command);

  return `https://${params.Bucket}.s3.amazonaws.com/${params.Key}`;
}

const postUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: 'post-s',
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const filename = '';
      cb(null, filename);
    }
  })
});
