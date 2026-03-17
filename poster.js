// scripts/poster.js
// Posts carousel content to LinkedIn, Instagram, Facebook, and TikTok

import fs from 'fs/promises';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { CONFIG } from './config.js';

// ─────────────────────────────────────────────
// IMAGE HOSTING (imgbb — free, needed for IG)
// ─────────────────────────────────────────────

async function uploadToImgbb(imagePath) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) throw new Error('IMGBB_API_KEY not set');

  const imageData = await fs.readFile(imagePath, { encoding: 'base64' });

  const form = new URLSearchParams();
  form.append('key', apiKey);
  form.append('image', imageData);
  form.append('expiration', '86400'); // 24 hour expiry — we only need it long enough to post

  const res = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    body: form,
  });

  const data = await res.json();
  if (!data.success) throw new Error(`imgbb upload failed: ${JSON.stringify(data)}`);

  return data.data.url;
}

// ─────────────────────────────────────────────
// LINKEDIN (PDF document upload)
// ─────────────────────────────────────────────

export async function postToLinkedIn(pdfPath, caption) {
  if (!CONFIG.platforms.linkedin.enabled) return console.log('⊘ LinkedIn disabled, skipping');

  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;
  if (!token || !orgId) return console.log('⊘ LinkedIn credentials not set, skipping');

  console.log('⎔ Posting to LinkedIn...');

  try {
    // Step 1: Register document upload
    const registerRes = await fetch('https://api.linkedin.com/rest/documents?action=initializeUpload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202602',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: orgId,
        },
      }),
    });

    const registerData = await registerRes.json();
    const uploadUrl = registerData.value?.uploadUrl;
    const documentUrn = registerData.value?.document;

    if (!uploadUrl || !documentUrn) {
      throw new Error(`LinkedIn register failed: ${JSON.stringify(registerData)}`);
    }

    // Step 2: Upload the PDF
    const pdfBuffer = await fs.readFile(pdfPath);
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: pdfBuffer,
    });

    if (!uploadRes.ok) throw new Error(`LinkedIn upload failed: ${uploadRes.status}`);

    // Step 3: Create post with document
    const postRes = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202602',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author: orgId,
        commentary: caption,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          media: {
            title: 'The London Choral Service',
            id: documentUrn,
          },
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });

    if (postRes.ok || postRes.status === 201) {
      console.log('  ✓ LinkedIn: Posted successfully');
    } else {
      const err = await postRes.text();
      console.error(`  ✗ LinkedIn: ${postRes.status} — ${err}`);
    }
  } catch (err) {
    console.error(`  ✗ LinkedIn error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// INSTAGRAM (Graph API carousel)
// ─────────────────────────────────────────────

export async function postToInstagram(imagePaths, caption) {
  if (!CONFIG.platforms.instagram.enabled) return console.log('⊘ Instagram disabled, skipping');

  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;
  if (!token || !igUserId) return console.log('⊘ Instagram credentials not set, skipping');

  console.log('⎔ Posting to Instagram...');

  try {
    // Step 1: Upload images to imgbb (IG needs public URLs)
    console.log('  ⎔ Uploading images to imgbb...');
    const imageUrls = [];
    for (const imgPath of imagePaths) {
      const url = await uploadToImgbb(imgPath);
      imageUrls.push(url);
    }
    console.log(`  ✓ ${imageUrls.length} images uploaded`);

    // Step 2: Create child containers for each image
    const containerIds = [];
    for (const url of imageUrls) {
      const res = await fetch(
        `https://graph.instagram.com/v25.0/${igUserId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: url,
            is_carousel_item: true,
            access_token: token,
          }),
        }
      );
      const data = await res.json();
      if (data.id) {
        containerIds.push(data.id);
      } else {
        console.error(`  ✗ IG container creation failed:`, data);
      }
    }

    // Step 3: Create carousel container
    const carouselRes = await fetch(
      `https://graph.instagram.com/v25.0/${igUserId}/media`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          children: containerIds.join(','),
          caption: caption,
          access_token: token,
        }),
      }
    );
    const carouselData = await carouselRes.json();

    if (!carouselData.id) {
      throw new Error(`IG carousel creation failed: ${JSON.stringify(carouselData)}`);
    }

    // Step 4: Publish
    // Wait for processing
    await new Promise((r) => setTimeout(r, 5000));

    const publishRes = await fetch(
      `https://graph.instagram.com/v25.0/${igUserId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: carouselData.id,
          access_token: token,
        }),
      }
    );
    const publishData = await publishRes.json();

    if (publishData.id) {
      console.log(`  ✓ Instagram: Published (media ID: ${publishData.id})`);
    } else {
      console.error(`  ✗ Instagram publish failed:`, publishData);
    }
  } catch (err) {
    console.error(`  ✗ Instagram error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// FACEBOOK (multi-image post via Graph API)
// ─────────────────────────────────────────────

export async function postToFacebook(imagePaths, caption) {
  if (!CONFIG.platforms.facebook.enabled) return console.log('⊘ Facebook disabled, skipping');

  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID;
  if (!token || !pageId) return console.log('⊘ Facebook credentials not set, skipping');

  console.log('⎔ Posting to Facebook...');

  try {
    // Step 1: Upload each image as unpublished photo
    const photoIds = [];
    for (const imgPath of imagePaths) {
      const url = await uploadToImgbb(imgPath);

      const res = await fetch(`https://graph.facebook.com/v25.0/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          published: false,
          access_token: token,
        }),
      });
      const data = await res.json();
      if (data.id) {
        photoIds.push(data.id);
      } else {
        console.error('  ✗ FB photo upload failed:', data);
      }
    }

    // Step 2: Create multi-photo post
    const attachedMedia = photoIds.map((id) => ({ media_fbid: id }));

    const postRes = await fetch(`https://graph.facebook.com/v25.0/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: caption,
        attached_media: attachedMedia,
        access_token: token,
      }),
    });
    const postData = await postRes.json();

    if (postData.id) {
      console.log(`  ✓ Facebook: Posted (post ID: ${postData.id})`);
    } else {
      console.error('  ✗ Facebook post failed:', postData);
    }
  } catch (err) {
    console.error(`  ✗ Facebook error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// TIKTOK (photo post via Content Posting API)
// ─────────────────────────────────────────────

export async function postToTikTok(imagePaths, caption) {
  if (!CONFIG.platforms.tiktok.enabled) return console.log('⊘ TikTok disabled, skipping');

  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) return console.log('⊘ TikTok credentials not set, skipping');

  console.log('⎔ Posting to TikTok...');

  try {
    // Step 1: Initialize photo post
    const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        post_info: {
          title: caption.substring(0, 150), // TikTok title limit
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: await Promise.all(
            imagePaths.map(async (p) => await uploadToImgbb(p))
          ),
        },
        media_type: 'PHOTO',
      }),
    });

    const initData = await initRes.json();

    if (initData.data?.publish_id) {
      console.log(`  ✓ TikTok: Initiated (publish ID: ${initData.data.publish_id})`);
      // TikTok processes asynchronously — check status later if needed
    } else {
      console.error('  ✗ TikTok init failed:', initData);
      console.log('  ℹ TikTok photo posts require approved developer access.');
      console.log('    Apply at: https://developers.tiktok.com/');
    }
  } catch (err) {
    console.error(`  ✗ TikTok error: ${err.message}`);
  }
}
