// scripts/poster.js
// Posts carousel content to LinkedIn, Instagram, and Facebook

import fs from 'fs/promises';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { CONFIG } from './config.js';
import { fetchWithRetry } from './utils/retry.js';

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

  const res = await fetchWithRetry('https://api.imgbb.com/1/upload', {
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
  if (!CONFIG.platforms.linkedin.enabled) {
    throw new Error('LinkedIn disabled in config');
  }

  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;
  if (!token || !orgId) {
    throw new Error('LinkedIn credentials not set');
  }

  console.log('⎔ Posting to LinkedIn...');

  // Step 1: Register document upload
  const registerRes = await fetchWithRetry('https://api.linkedin.com/rest/documents?action=initializeUpload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': CONFIG.api.linkedInVersion,
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
  const uploadRes = await fetchWithRetry(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: pdfBuffer,
  });

  if (!uploadRes.ok) throw new Error(`LinkedIn upload failed: ${uploadRes.status}`);

  // Step 3: Create post with document
  const postRes = await fetchWithRetry('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': CONFIG.api.linkedInVersion,
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
    return { platform: 'linkedin', success: true };
  }

  const err = await postRes.text();
  throw new Error(`LinkedIn post failed: ${postRes.status} — ${err}`);
}

// ─────────────────────────────────────────────
// INSTAGRAM (Graph API carousel)
// ─────────────────────────────────────────────

export async function postToInstagram(imagePaths, caption) {
  if (!CONFIG.platforms.instagram.enabled) {
    throw new Error('Instagram disabled in config');
  }

  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;
  if (!token || !igUserId) {
    throw new Error('Instagram credentials not set');
  }

  console.log('⎔ Posting to Instagram...');

  // Step 1: Upload images to imgbb in parallel (IG needs public URLs)
  console.log('  ⎔ Uploading images to imgbb...');
  const imageUrls = await Promise.all(imagePaths.map((p) => uploadToImgbb(p)));
  console.log(`  ✓ ${imageUrls.length} images uploaded`);

  // Step 2: Create child containers for each image
  const containerIds = [];
  for (const url of imageUrls) {
    const res = await fetchWithRetry(
      `https://graph.instagram.com/${CONFIG.api.graphApiVersion}/${igUserId}/media`,
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

  if (containerIds.length === 0) {
    throw new Error('IG: all container creations failed — no images to post');
  }
  if (containerIds.length < imageUrls.length) {
    console.warn(`  ⚠ IG: only ${containerIds.length}/${imageUrls.length} containers created — posting partial carousel`);
  }

  // Step 3: Create carousel container
  const carouselRes = await fetchWithRetry(
    `https://graph.instagram.com/${CONFIG.api.graphApiVersion}/${igUserId}/media`,
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

  const publishRes = await fetchWithRetry(
    `https://graph.instagram.com/${CONFIG.api.graphApiVersion}/${igUserId}/media_publish`,
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
    return { platform: 'instagram', success: true, postId: publishData.id };
  }

  throw new Error(`Instagram publish failed: ${JSON.stringify(publishData)}`);
}

// ─────────────────────────────────────────────
// FACEBOOK (multi-image post via Graph API)
// ─────────────────────────────────────────────

export async function postToFacebook(imagePaths, caption) {
  if (!CONFIG.platforms.facebook.enabled) {
    throw new Error('Facebook disabled in config');
  }

  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FB_PAGE_ID;
  if (!token || !pageId) {
    throw new Error('Facebook credentials not set');
  }

  console.log('⎔ Posting to Facebook...');

  // Step 1: Upload each image as unpublished photo (parallel)
  const imageUrls = await Promise.all(imagePaths.map((p) => uploadToImgbb(p)));

  const photoIds = [];
  for (const url of imageUrls) {
    const res = await fetchWithRetry(`https://graph.facebook.com/${CONFIG.api.graphApiVersion}/${pageId}/photos`, {
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

  if (photoIds.length === 0) {
    throw new Error('FB: all photo uploads failed — nothing to post');
  }
  if (photoIds.length < imageUrls.length) {
    console.warn(`  ⚠ FB: only ${photoIds.length}/${imageUrls.length} photos uploaded — posting partial`);
  }

  // Step 2: Create multi-photo post
  const attachedMedia = photoIds.map((id) => ({ media_fbid: id }));

  const postRes = await fetchWithRetry(`https://graph.facebook.com/${CONFIG.api.graphApiVersion}/${pageId}/feed`, {
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
    return { platform: 'facebook', success: true, postId: postData.id };
  }

  throw new Error(`Facebook post failed: ${JSON.stringify(postData)}`);
}

// ─────────────────────────────────────────────
// MULTI-PLATFORM WRAPPER
// ─────────────────────────────────────────────

/**
 * Publish to all requested platforms, collecting results.
 * @param {object} post - { pdfPath, imagePaths, captions: { linkedin, instagram, facebook, default } }
 * @param {string[]} platforms - ['linkedin', 'instagram', 'facebook']
 * @returns {{ results: Array, allSucceeded: boolean, failedPlatforms: string[] }}
 */
export async function publishToAllPlatforms(post, platforms) {
  const results = [];
  const failedPlatforms = [];

  for (const platform of platforms) {
    try {
      let result;
      const caption = post.captions[platform] || post.captions.default || '';
      switch (platform) {
        case 'linkedin':
          result = await postToLinkedIn(post.pdfPath, caption);
          break;
        case 'instagram':
          result = await postToInstagram(post.imagePaths, caption);
          break;
        case 'facebook':
          result = await postToFacebook(post.imagePaths, caption);
          break;
        default:
          result = { platform, success: false, error: `Unknown platform: ${platform}` };
      }
      results.push(result);
    } catch (err) {
      results.push({ platform, success: false, error: err.message });
      failedPlatforms.push(platform);
    }
  }

  return {
    results,
    allSucceeded: failedPlatforms.length === 0,
    failedPlatforms,
  };
}
