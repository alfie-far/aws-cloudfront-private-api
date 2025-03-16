import { Resource } from 'sst';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({});

export async function upload() {
  const command = new PutObjectCommand({
    Key: crypto.randomUUID(),
    Bucket: Resource.MyBucket.name,
  });

  return {
    statusCode: 200,
    body: await getSignedUrl(s3, command),
  };
}

export async function latest() {
  // const objects = await s3.send(
  //   new ListObjectsV2Command({
  //     Bucket: Resource.MyBucket.name,
  //   }),
  // );
  //
  // const latestFile = objects.Contents!.sort(
  //   (a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0),
  // )[0];
  //
  // const command = new GetObjectCommand({
  //   Key: latestFile.Key,
  //   Bucket: Resource.MyBucket.name,
  // });

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Go Serverless v3.0! Your function executed successfully!',
      output: {
        test: 'PASS',
      },
    }),
    headers: {
      'Content-Type': 'application/json',
      'X-QC-ABC': crypto.randomBytes(64).toString('hex'),
    },
  };
}
