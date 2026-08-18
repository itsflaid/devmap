import type { SignalDescriptor } from "./types.js";

export const DESCRIPTORS: SignalDescriptor[] = [
  {
    name: "File Upload",
    category: "feature",
    purpose: "Handles file ingestion, cloud storage, and upload providers.",
    genericTerms: [
      "multer", "formidable", "busboy", "cloudinary", "uploadthing",
      "aws-sdk/s3", "@aws-sdk/client-s3", "minio", "backblaze",
      "firebase/storage", "@supabase/storage",
      "upload", "storage", "bucket", "blob",
    ],
  },
  {
    name: "Cloudinary",
    category: "provider",
    importNames: ["cloudinary"],
  },
];