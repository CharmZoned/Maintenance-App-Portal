-- Property-documents MIME allowlist on the storage bucket.
-- Rejects HTML/SVG/etc. at upload; FE accept= mirrors this set.
-- One concern: document MIME policy (no AuthZ RPC / photo-cap changes).

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
WHERE id = 'property-documents';
