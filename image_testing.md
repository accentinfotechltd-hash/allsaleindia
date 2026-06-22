# Image Integration Test Playbook

## Image Handling Rules
- Always use base64-encoded images for tests/requests
- Accepted formats: JPEG, PNG, WEBP only
- Do not use SVG, BMP, HEIC, or other formats
- Do not upload blank, solid-color, or uniform-variance images
- Every image must contain real visual features — objects, edges, textures, shadows
- If image is not PNG/JPEG/WEBP, transcode to PNG or JPEG before upload
- If MIME mismatch after transformation, re-detect and update MIME
- If image is animated (GIF, APNG, animated WEBP), extract first frame only
- Resize large images to reasonable bounds (avoid oversized payloads)
