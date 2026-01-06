# Frame + Flow - Site scaffold (Vite)

This folder is meant to be deployed as the public storefront.

## Netlify settings
- Base directory: `site`
- Build command: `npm run build`
- Publish directory: `dist`

## Netlify environment variables
- NODE_VERSION=20
- VITE_API_BASE=https://<your-render-service>.onrender.com

## API expectation
This scaffold expects a public endpoint:
GET /api/artworks

Return JSON array of items with at least:
- title
- price (optional)
- one of: image_url / primary_image_url / featured_image_url / images[]
