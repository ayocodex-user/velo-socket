import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
/**
 * Uploads a file to S3
 * @param BUCKET_NAME - The name of the S3 bucket
 * @param file - The file to upload
 * @param fileKey - The key of the file
 * @param contentType - The content type of the file
 * @returns The URL of the uploaded file
 */
export async function uploadFileToS3(BUCKET_NAME: string, file: Buffer, fileKey: string, contentType: string) {
  const params = {
    Bucket: BUCKET_NAME,
    Key: fileKey,
    Body: file,
    ContentType: contentType,
  };

  const command = new PutObjectCommand(params);
  await s3Client.send(command);

  return `https://${params.Bucket}.s3.amazonaws.com/${params.Key}`;
}

/**
 * Deletes one or more files from S3
 * @param BUCKET_NAME - The name of the S3 bucket
 * @param fileKeys - The keys of the files to delete
 */
export async function deleteFileFromS3(BUCKET_NAME: string, fileKeys: string[]) {
  for (const fileKey of fileKeys) {
  const input = {
    Bucket: BUCKET_NAME,
    Key: fileKey
    };
    const command = new DeleteObjectCommand(input);
    await s3Client.send(command);
  }
}

/**
 * Multer storage for S3
 * @returns The multer storage for S3
 */
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
