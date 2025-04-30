// Define CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Cache-Control, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

// Define pagination constants
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Handle OPTIONS request for CORS preflight
function handleOptions(request) {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    return new Response(null, {
      headers: corsHeaders,
      status: 204
    });
  } else {
    return new Response(null, {
      headers: corsHeaders
    });
  }
}

// Helper to create standardized responses
function createResponse(body, status = 200, cacheDuration = 60*60*24) {
  // Don't allow null or undefined body
  if (body === null || body === undefined) {
    console.error('createResponse called with null or undefined body');
    body = { error: 'Empty response body' };
    status = 500;
  }
  
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders // Add CORS headers
  };
  
  if (cacheDuration > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheDuration}`;
    headers['CDN-Cache-Control'] = `public, max-age=${cacheDuration}`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  
  // Log the response details for debugging
  console.log(`Creating response: status=${status}, headers=${JSON.stringify(headers)}, body type=${typeof body}`);
  
  // Create a standard Response object
  // This ensures properties like 'ok' are properly set based on status code
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}

// Helper function to validate request parameters
function validateRequest(request, requiredParams = []) {
  const url = new URL(request.url);
  const missingParams = requiredParams.filter(param => !url.searchParams.has(param));
  
  if (missingParams.length > 0) {
    return createResponse({
      error: 'Missing required parameters',
      missing: missingParams
    }, 400);
  }
  
  return null;
}

// Helper function to get cache control headers
function getCacheControl(path) {
  const cacheRules = {
    '/api/health': 'public, max-age=3600',
    '/api/proposals': 'public, max-age=300, stale-while-revalidate=60',
    '/api/comments': 'public, max-age=60, stale-while-revalidate=30',
    default: 'no-cache'
  };
  
  return cacheRules[path] || cacheRules.default;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      
      console.log(`Received request for path: ${path}`);
      console.log(`Full URL: ${url.toString()}`);

      // Handle CORS preflight requests
      if (request.method === 'OPTIONS') {
        return handleOptions();
      }

      // Set cache control headers based on path
      const cacheControl = getCacheControl(path);
      const headers = new Headers();
      headers.set('Cache-Control', cacheControl);

      // Handle static assets
      if (path === '/styles.css' || path === '/index.html' || path === '/') {
        console.log('Routing to static asset handler');
        return serveStaticAsset(request, env);
      }

      // Handle media files
      if (path.startsWith('/memes/') || path.startsWith('/audio/')) {
        return serveMedia(request, env);
      }

      // Handle API endpoints
      if (path.startsWith('/api/')) {
        try {
          // Validate request parameters for specific endpoints
          if (path === '/api/proposals' && request.method === 'GET') {
            const validationError = validateRequest(request, ['userId']);
            if (validationError) return validationError;
            return await getProposals(request, env);
          } else if (path === '/api/proposals' && request.method === 'POST') {
            return await createProposal(request, env);
          } else if (path === '/api/comments' && request.method === 'GET') {
            const validationError = validateRequest(request, ['proposalId']);
            if (validationError) return validationError;
            return await getComments(request, env);
          } else if (path === '/api/comments' && request.method === 'POST') {
            return await createComment(request, env);
          } else if (path === '/api/votes' && request.method === 'POST') {
            return await createOrUpdateVote(request, env);
          } else if (path === '/api/users' && request.method === 'POST') {
            return await createOrGetUser(request, env);
          } else if (path === '/api/memes' && request.method === 'POST') {
            return await uploadMeme(request, env);
          } else if (path === '/api/comment-votes' && request.method === 'POST') {
            return await createOrUpdateCommentVote(request, env);
          } else if (path === '/api/comment-votes' && request.method === 'GET') {
            return await getCommentVotes(request, env);
          } else if (path === '/api/petition-stats' && request.method === 'GET') {
            return await getPetitionStats(request, env);
          } else if (path === '/api/petition-svg' && request.method === 'GET') {
            return await servePetitionSVG(request, env);
          } else if (path === '/api/health' && request.method === 'GET') {
            return await healthCheck(env);
          } else if (path === '/api/debug-meta' && request.method === 'GET') {
            return await debugMetaTags(request, env);
          } else if (path.startsWith('/api/proposals/') && request.method === 'GET') {
            return await getProposalById(request, env);
          }
        } catch (error) {
          console.error('API Error:', error);
          return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Return 404 for unknown routes
      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Unhandled error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

// ... existing code ...

// Handle media files (memes and audio)
async function serveMedia(request, env) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Extract the filename from the path
    const filename = path.split('/').pop();
    
    // Determine the correct bucket based on the path
    const bucket = path.startsWith('/memes/') ? env.MEMES_BUCKET : env.AUDIO_BUCKET;
    
    if (!bucket) {
      console.error('Missing bucket binding');
      return new Response('Internal Server Error', { status: 500 });
    }
    
    // Get the object from R2
    const object = await bucket.get(filename);
    
    if (!object) {
      console.error(`File not found: ${filename}`);
      return new Response('File Not Found', { status: 404 });
    }
    
    // Determine content type based on file extension
    const contentType = path.endsWith('.mp3') ? 'audio/mpeg' : 'image/jpeg';
    
    // Create response with appropriate headers
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for a year
    headers.set('Access-Control-Allow-Origin', '*');
    
    return new Response(object.body, {
      headers,
      status: 200
    });
  } catch (error) {
    console.error('Error serving media:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// Handle static assets
async function serveStaticAsset(request, env) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    
    console.log(`Attempting to serve static asset: ${path}`);
    
    // Get the asset from the ASSETS binding
    const asset = await env.ASSETS.get(path.substring(1));
    
    if (!asset) {
      console.error(`Asset not found in bucket: ${path}`);
      return new Response('Asset Not Found', { status: 404 });
    }
    
    console.log(`Asset found, size: ${asset.size} bytes`);
    
    // Determine content type based on file extension
    let contentType = 'text/plain';
    if (path.endsWith('.css')) {
      contentType = 'text/css';
    } else if (path.endsWith('.js')) {
      contentType = 'application/javascript';
    } else if (path.endsWith('.html')) {
      contentType = 'text/html';
    }
    
    console.log(`Content type set to: ${contentType}`);
    
    // Create response with appropriate headers
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=31536000'); // 1 year cache
    headers.set('Access-Control-Allow-Origin', '*');
    
    // Get the asset body as text
    const body = await asset.text();
    
    return new Response(body, {
      headers,
      status: 200
    });
  } catch (error) {
    console.error('Error serving static asset:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// ... existing code ...

async function serveMainPage(request, env) {
  try {
    // Fetch directly from Cloudflare Pages
    const response = await fetch('https://radical.pages.dev/index.html', {
      headers: {
        'User-Agent': request.headers.get('User-Agent') || 'Cloudflare Worker'
      }
    });
    
    if (!response.ok) {
      console.error('Failed to fetch main page', response.status, response.statusText);
      return new Response('Failed to load page', { status: 500 });
    }
    
    // Read the HTML content
    const html = await response.text();
    
    // Create a new response with the HTML content
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=86400',
        // Add CORS headers if needed
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Comprehensive error serving main page:', error);
    return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}

async function serveLoginPage(request, env) {
  try {
    // Fetch the login HTML file from your storage
    // You could store this in R2 bucket or GitHub Pages like your other static files
    const response = await fetch('https://radical.pages.dev/radical/login.html', {
      headers: {
        'User-Agent': request.headers.get('User-Agent') || 'Cloudflare Worker'
      }
    });
    
    if (!response.ok) {
      console.error('Failed to fetch login page', response.status, response.statusText);
      return new Response('Failed to load login page', { status: 500 });
    }
    
    // Read the HTML content
    const html = await response.text();
    
    // Create a new response with the HTML content
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Error serving login page:', error);
    return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}

// Function to validate user login with emoji combination and selections
async function validateLogin(request, env) {
  try {
    const data = await request.json();
    const { 
      emojiCombination, 
      selectedDictator, 
      selectedTarget 
    } = data;
    
    console.log(`Processing login attempt: ${JSON.stringify({
      emojiCount: emojiCombination?.length || 0,
      dictator: selectedDictator,
      target: selectedTarget
    })}`);
    
    // Basic validation
    if (!emojiCombination || !selectedDictator || !selectedTarget) {
      return createResponse({ 
        error: 'Missing required fields', 
        received: { 
          hasEmojis: !!emojiCombination, 
          hasDictator: !!selectedDictator, 
          hasTarget: !!selectedTarget 
        } 
      }, 400);
    }
    
    // Convert emoji array to string for storage/comparison
    const emojiCombinationString = Array.isArray(emojiCombination) 
      ? emojiCombination.join('') 
      : emojiCombination;
    
    // Check if dictator exists
    const dictatorCheck = await env.DB.prepare(
      `SELECT id FROM dictators WHERE id = ?`
    ).bind(selectedDictator).first();
    
    if (!dictatorCheck) {
      return createResponse({ 
        error: 'Invalid dictator selection', 
        dictatorId: selectedDictator 
      }, 400);
    }
    
    // Check if target exists
    const targetCheck = await env.DB.prepare(
      `SELECT id FROM time_targets WHERE id = ?`
    ).bind(selectedTarget).first();
    
    if (!targetCheck) {
      return createResponse({ 
        error: 'Invalid time target selection', 
        targetId: selectedTarget 
      }, 400);
    }
    
    // Record the login attempt (for security tracking)
    const attemptId = 'login_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const timestamp = Date.now();
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    
    try {
      // Try to find a user with the exact combination
      const user = await env.DB.prepare(`
        SELECT id, name, emoji_combination, selected_dictator_id, selected_target_id 
        FROM users 
        WHERE emoji_combination = ? 
        AND selected_dictator_id = ? 
        AND selected_target_id = ?
      `).bind(
        emojiCombinationString, 
        selectedDictator, 
        selectedTarget
      ).first();
      
      // Log the attempt, regardless of outcome
      await env.DB.prepare(`
        INSERT INTO login_attempts (
          id, 
          user_id, 
          emoji_combination, 
          dictator_id, 
          target_id, 
          timestamp, 
          ip_address, 
          success
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        attemptId,
        user ? user.id : null,
        emojiCombinationString,
        selectedDictator,
        selectedTarget,
        timestamp,
        clientIP,
        user ? 1 : 0
      ).run();
      
      if (user) {
        // Login successful - Update last login time
        await env.DB.prepare(`
          UPDATE users 
          SET last_login = ? 
          WHERE id = ?
        `).bind(timestamp, user.id).run();
        
        console.log(`Successful login for user ${user.id}`);
        
        // Return success with user info (excluding sensitive data)
        return createResponse({
          success: true,
          userId: user.id,
          username: user.name,
          message: "Login successful"
        });
      } else {
        // No matching user found - this could be a new signup
        // Check if this is a unique emoji combination
        const existingCombo = await env.DB.prepare(`
          SELECT COUNT(*) as count
          FROM users
          WHERE emoji_combination = ?
        `).bind(emojiCombinationString).first();
        
        if (existingCombo.count > 0) {
          // Emoji combination exists but other parameters don't match
          return createResponse({
            error: "Invalid credentials",
            message: "The combination you entered is incorrect"
          }, 401);
        }
        
        // This is a new user registration
        const newUserId = 'citizen_' + Math.random().toString(36).substr(2, 9);
        const newUsername = 'Citizen ' + Math.floor(Math.random() * 9000 + 1000);
        
        // Create the new user
        await env.DB.prepare(`
          INSERT INTO users (
            id, 
            name, 
            created_at, 
            emoji_combination, 
            selected_dictator_id, 
            selected_target_id,
            last_login
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          newUserId,
          newUsername,
          timestamp,
          emojiCombinationString,
          selectedDictator,
          selectedTarget,
          timestamp
        ).run();
        
        console.log(`Created new user ${newUserId} with emoji login`);
        
        // Return success with new user info
        return createResponse({
          success: true,
          isNewUser: true,
          userId: newUserId,
          username: newUsername,
          message: "Account created successfully"
        });
      }
    } catch (dbError) {
      console.error('Database error during login validation:', dbError);
      
      return createResponse({
        error: "Login processing error",
        details: "An error occurred while processing your login"
      }, 500);
    }
  } catch (error) {
    console.error('Error in login validation:', error);
    
    return createResponse({
      error: "Login request error",
      message: "Could not process login request"
    }, 500);
  }
}

async function createOrUpdateCommentVote(request, env) {
  try {
    const data = await request.json();
    const { commentId, userId, voteType } = data;
    
    console.log(`Processing comment vote: ${JSON.stringify({
      commentId, 
      userId, 
      voteType
    })}`);
    
    if (!commentId || !userId || !voteType) {
      return createResponse({ 
        error: 'Missing required fields', 
        received: { commentId, userId, voteType: voteType || 'undefined' } 
      }, 400);
    }
    
    if (voteType !== 'upvote' && voteType !== 'downvote') {
      return createResponse({ 
        error: 'Invalid vote type', 
        voteType, 
        allowedValues: ['upvote', 'downvote'] 
      }, 400);
    }
    
    // Check if entities exist
    try {
      const userCheck = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
      if (!userCheck) {
        return createResponse({ error: 'User does not exist', userId }, 404);
      }
      
      const commentCheck = await env.DB.prepare(`SELECT id FROM comments WHERE id = ?`).bind(commentId).first();
      if (!commentCheck) {
        return createResponse({ error: 'Comment does not exist', commentId }, 404);
      }
    } catch (checkError) {
      return createResponse({ 
        error: 'Error checking user or comment existence', 
        details: logError(checkError, { action: 'check_entities', userId, commentId })
      }, 500);
    }
    
    // Check if vote already exists
    let existingVote;
    try {
      const checkQuery = `
        SELECT id, vote_type FROM comment_votes
        WHERE comment_id = ? AND user_id = ?
      `;
      
      existingVote = await env.DB.prepare(checkQuery).bind(commentId, userId).first();
      console.log(`Existing comment vote check: ${existingVote ? JSON.stringify(existingVote) : 'None found'}`);
    } catch (voteCheckError) {
      return createResponse({ 
        error: 'Error checking existing comment vote', 
        details: logError(voteCheckError, { action: 'check_comment_vote', userId, commentId })
      }, 500);
    }
    
    const timestamp = Date.now();
    const voteId = existingVote ? existingVote.id : 'comment_vote_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    
    try {
      // Process vote
      if (existingVote) {
        // If vote exists and it's the same type, remove it (toggle off)
        if (existingVote.vote_type === voteType) {
          await env.DB.prepare(`
            DELETE FROM comment_votes
            WHERE id = ?
          `).bind(existingVote.id).run();
          
          console.log(`Deleted comment vote ${existingVote.id} (toggle off)`);
          
          return createResponse({ 
            commentId, 
            userId, 
            voteType: null,
            action: 'removed'
          });
        } else {
          // If vote exists but is different type, update it
          await env.DB.prepare(`
            UPDATE comment_votes
            SET vote_type = ?, timestamp = ?
            WHERE id = ?
          `).bind(
            voteType, 
            timestamp, 
            existingVote.id
          ).run();
          
          console.log(`Updated comment vote ${existingVote.id} to ${voteType}`);
          
          return createResponse({ 
            commentId, 
            userId, 
            voteType,
            action: 'updated'
          });
        }
      } else {
        // If no vote exists, create new one
        await env.DB.prepare(`
          INSERT INTO comment_votes (id, comment_id, user_id, vote_type, timestamp)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          voteId, 
          commentId, 
          userId, 
          voteType, 
          timestamp
        ).run();
        
        console.log(`Created new comment vote with ID: ${voteId}`);
        
        return createResponse({ 
          commentId, 
          userId, 
          voteType,
          action: 'created'
        });
      }
    } catch (dbError) {
      return createResponse({ 
        error: 'Failed to process comment vote in database', 
        details: logError(dbError, { 
          action: 'process_comment_vote', 
          existingVote: existingVote || null,
          newVote: { commentId, userId, voteType }
        })
      }, 500);
    }
  } catch (error) {
    return createResponse({ 
      error: 'Failed to process comment vote request', 
      details: logError(error, { action: 'comment_vote_outer' })
    }, 500);
  }
}

// Function to get votes for a specific comment
async function getCommentVotes(request, env) {
  try {
    const url = new URL(request.url);
    const commentId = url.searchParams.get('commentId');
    const userId = url.searchParams.get('userId');
    
    if (!commentId) {
      return createResponse({ error: 'Missing commentId parameter' }, 400);
    }
    
    // Get vote counts
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM comment_votes WHERE comment_id = ? AND vote_type = 'upvote') as upvotes,
        (SELECT COUNT(*) FROM comment_votes WHERE comment_id = ? AND vote_type = 'downvote') as downvotes
    `;
    
    try {
      const voteCounts = await env.DB.prepare(query).bind(commentId, commentId).first();
      
      let userVote = null;
      // If userId is provided, get the user's vote
      if (userId) {
        const userVoteQuery = `
          SELECT vote_type FROM comment_votes
          WHERE comment_id = ? AND user_id = ?
        `;
        
        const userVoteResult = await env.DB.prepare(userVoteQuery).bind(commentId, userId).first();
        if (userVoteResult) {
          userVote = userVoteResult.vote_type;
        }
      }
      
      return createResponse({
        commentId,
        upvotes: voteCounts.upvotes || 0,
        downvotes: voteCounts.downvotes || 0,
        userVote
      });
    } catch (dbError) {
      return createResponse({
        error: 'Failed to retrieve comment votes',
        details: logError(dbError, { action: 'get_comment_votes', commentId })
      }, 500);
    }
  } catch (error) {
    return createResponse({
      error: 'Failed to process comment votes request',
      details: logError(error, { action: 'get_comment_votes_outer' })
    }, 500);
  }
}



// Serve meme files
async function serveMeme(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const key = path.replace('/memes/', '');
  
  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return handleOptions();
  }
  
  try {
    const object = await env.MEMES_BUCKET.get(key);
    
    if (object === null) {
      return new Response('Meme not found', { status: 404 });
    }
    
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for a year
    
    // Add CORS headers
    Object.keys(corsHeaders).forEach(key => {
      headers.set(key, corsHeaders[key]);
    });
    
    return new Response(object.body, {
      headers
    });
  } catch (error) {
    console.error('Error serving meme:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// Debug endpoint to help diagnose meta tag issues
async function debugMetaTags(request, env) {
  try {
    // Create a sample proposal for testing
    const testProposal = {
      id: 'test_proposal',
      text: 'This is a test proposal for meta tags',
      author_name: 'Test User',
      timestamp: Date.now()
    };
    
    // Generate a shareable image URL
    const shareImageUrl = getShareableImageUrl(testProposal);
    
    // Prepare detailed meta tag information
    const metaTagInfo = {
      og_image: shareImageUrl,
      og_title: 'RADICAL Meta Tag Test',
      og_description: 'Testing meta tag generation and injection',
      twitter_image: shareImageUrl,
      twitter_title: 'RADICAL Meta Tag Verification',
      twitter_description: 'Checking social media sharing metadata'
    };
    
    // Return detailed information about the meta tags
    return createResponse({
      status: 'success',
      message: 'Meta tag debug information',
      shareImageUrl: shareImageUrl,
      metaTagDetails: metaTagInfo
    });
  } catch (error) {
    return createResponse({ 
      error: 'Debug meta tags endpoint error', 
      details: logError(error, { action: 'debug_meta_tags' })
    }, 500);
  }
}

// Handle meme uploads to R2 storage
async function uploadMeme(request, env) {
  try {
    // Check if R2 binding exists
    if (!env.MEMES_BUCKET) {
      return createResponse({ 
        error: 'Storage binding missing. Check your settings configuration.' 
      }, 500);
    }

    // Handle multipart form data
    const formData = await request.formData();
    
    // Get the proposal ID
    const proposalId = formData.get('proposalId');
    if (!proposalId) {
      return createResponse({ error: 'Missing proposalId' }, 400);
    }
    
    // Get the file
    const file = formData.get('meme');
    if (!file || !(file instanceof File)) {
      return createResponse({ error: 'No file uploaded or invalid file' }, 400);
    }
    
    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return createResponse({ 
        error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.',
        received: file.type
      }, 400);
    }
    
    // Validate file size (limit to 2MB)
    const MAX_SIZE = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX_SIZE) {
      return createResponse({ 
        error: 'File too large. Maximum size is 2MB.',
        size: file.size,
        maxSize: MAX_SIZE
      }, 400);
    }
    
    // Create a unique filename
    const fileExt = file.name.split('.').pop();
    const uniqueFilename = `${proposalId}_${Date.now()}.${fileExt}`;
    
    // Upload to R2
    await env.MEMES_BUCKET.put(uniqueFilename, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    });
    
    // Generate the public URL
    const memeUrl = `https://theradicalparty.com/memes/${uniqueFilename}`;
    
    // Helper function to fix broken meme URLs
    function fixMemeUrl(url) {
      // Check if the URL contains the problematic domain
      if (url && url.includes('memes.undefined')) {
        // Extract the filename from the URL
        const filename = url.split('/').pop();
        // Replace with the correct domain
        return `https://theradicalparty.com/memes/${filename}`;
      }
      return url;
    }

    // Update the proposal with the meme URL
    try {
      await env.DB.prepare(`
        UPDATE proposals
        SET meme_url = ?
        WHERE id = ?
      `).bind(memeUrl, proposalId).run();
      
      console.log(`Added meme ${uniqueFilename} to proposal ${proposalId}`);
      
      return createResponse({ 
        success: true, 
        proposalId, 
        memeUrl 
      });
    } catch (dbError) {
      // If DB update fails, try to delete the uploaded file
      try {
        await env.MEMES_BUCKET.delete(uniqueFilename);
      } catch (deleteError) {
        console.error('Failed to delete orphaned file:', deleteError);
      }
      
      return createResponse({ 
        error: 'Failed to update proposal with meme URL', 
        details: logError(dbError, { action: 'update_proposal_meme', proposalId })
      }, 500);
    }
  } catch (error) {
    return createResponse({ 
      error: 'Failed to process meme upload', 
      details: logError(error, { action: 'upload_meme' })
    }, 500);
  }
}

// Get petition statistics
async function getPetitionStats(request, env) {
  try {
    const url = new URL(request.url);
    const proposalId = url.searchParams.get('proposalId');
    
    if (!proposalId) {
      return createResponse({ error: 'Missing proposalId parameter' }, 400);
    }
    
    // Get petition statistics
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT pd.user_id) as verified_count,
        (SELECT COUNT(*) FROM votes WHERE proposal_id = ? AND vote_type = 'upvote' AND is_petition = 1) as total_signatures,
        (SELECT text FROM proposals WHERE id = ?) as proposal_text
      FROM petition_details pd
      WHERE pd.proposal_id = ? AND pd.verified = 1
    `;
    
    const stats = await env.DB.prepare(statsQuery).bind(proposalId, proposalId, proposalId).first();
    
    if (!stats) {
      return createResponse({ error: 'Proposal not found' }, 404);
    }
    
    // Get top postcodes for this petition
    const postcodesQuery = `
      SELECT postcode, COUNT(*) as count
      FROM petition_details
      WHERE proposal_id = ? AND verified = 1
      GROUP BY postcode
      ORDER BY count DESC
      LIMIT 5
    `;
    
    const postcodes = await env.DB.prepare(postcodesQuery).bind(proposalId).all();
    
    return createResponse({
      proposalId,
      proposalText: stats.proposal_text,
      verifiedSignatures: stats.verified_count,
      totalSignatures: stats.total_signatures,
      topPostcodes: postcodes.results
    });
  } catch (error) {
    return createResponse({ 
      error: 'Failed to process petition stats request', 
      details: logError(error, { action: 'petition_stats', proposalId })
    }, 500);
  }
}

// Helper to log detailed errors 
function logError(error, context = {}) {
  const errorDetails = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    context: context
  };
  
  console.error(JSON.stringify(errorDetails));
  return errorDetails;
}

// Function to check if a table exists
async function tableExists(env, tableName) {
  try {
    const query = "SELECT name FROM sqlite_master WHERE type='table' AND name = ?";
    const result = await env.DB.prepare(query).bind(tableName).first();
    return !!result;
  } catch (error) {
    logError(error, { action: 'check_table_exists', tableName });
    return false;
  }
}

// Simple health check endpoint
async function healthCheck(env) {
  try {
    // Check if DB binding exists
    if (!env.DB) {
      return createResponse({ 
        status: 'error', 
        error: 'Database binding missing. Check wrangler.toml configuration.'
      }, 500);
    }
    
    // Check if we can execute a simple query
    try {
      const result = await env.DB.prepare("SELECT 1 as db_check").first();
      if (!result || result.db_check !== 1) {
        return createResponse({ 
          status: 'error', 
          error: 'Database query failed to return expected result'
        }, 500);
      }
    } catch (dbError) {
      return createResponse({ 
        status: 'error', 
        error: 'Database query execution failed',
        details: logError(dbError, { action: 'health_check_query' })
      }, 500);
    }
    
    // Check if required tables exist
    const tables = ['users', 'proposals', 'votes', 'petition_details'];
    const tableStatus = {};
    
    for (const table of tables) {
      tableStatus[table] = await tableExists(env, table);
    }
    
    const missingTables = Object.keys(tableStatus).filter(table => !tableStatus[table]);
    
    if (missingTables.length > 0) {
      return createResponse({ 
        status: 'warning', 
        message: 'Database connected but some tables are missing',
        missingTables,
        tableStatus
      }, 200);
    }
    
    return createResponse({ 
      status: 'ok', 
      message: 'Database connection and tables verified',
      database: env.DB.name || 'unknown',
      tableStatus
    }, 200);
  } catch (error) {
    return createResponse({ 
      status: 'error', 
      error: 'Health check failed',
      details: logError(error, { action: 'health_check' })
    }, 500);
  }
}

// Get proposals with optional sorting
async function getProposals(request, env) {
  try {
    // Define pagination constants locally to ensure they're in scope
    const DEFAULT_PAGE_SIZE = 20;
    const MAX_PAGE_SIZE = 100;
    
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = Math.min(
      parseInt(url.searchParams.get('limit')) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE
    );
    const offset = (page - 1) * limit;
    const sortBy = url.searchParams.get('sortBy') || 'newest';
    
    console.log(`Getting proposals with sorting: ${sortBy}, page: ${page}, limit: ${limit}`);
    
    // Define the base query
    let query = `
      SELECT 
        p.id, p.text, p.timestamp, p.trending, p.meme_url,
        u.name as author_name, u.id as author_id,
        (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'upvote') as upvotes,
        (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'downvote') as downvotes,
        (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'upvote' AND is_petition = 1) as petition_signatures,
        (SELECT COUNT(DISTINCT pd.user_id) FROM petition_details pd WHERE pd.proposal_id = p.id AND pd.verified = 1) as verified_petitioners
      FROM proposals p
      JOIN users u ON p.author_id = u.id
    `;
    
    // Add sorting
    if (sortBy === 'newest') {
      query += ` ORDER BY p.timestamp DESC`;
    } else if (sortBy === 'oldest') {
      query += ` ORDER BY p.timestamp ASC`;
    } else if (sortBy === 'popular') {
      query += ` ORDER BY upvotes DESC, p.timestamp DESC`;
    } else if (sortBy === 'controversial') {
      query += ` ORDER BY (upvotes + downvotes) DESC, ABS(upvotes - downvotes) ASC, p.timestamp DESC`;
    } else {
      // Default to newest
      query += ` ORDER BY p.timestamp DESC`;
    }
    
    // Add pagination
    query += ` LIMIT ? OFFSET ?`;
    
    console.log(`Executing query with pagination: limit=${limit}, offset=${offset}`);
    
    // Execute the query
    const proposals = await env.DB.prepare(query).bind(limit, offset).all();
    
    console.log(`Retrieved ${proposals.results?.length || 0} proposals`);
    
    // Add pagination info to response
    return createResponse({
      data: proposals.results,
      pagination: {
        page,
        limit,
        total: proposals.results?.length || 0,
        hasMore: proposals.results?.length === limit
      }
    });
  } catch (error) {
    console.error('Error retrieving proposals:', error);
    return createResponse({ 
      error: 'Failed to retrieve proposals', 
      details: logError(error, { action: 'get_proposals' })
    }, 500);
  }
}

// Get a single proposal by ID
async function getProposalById(request, env) {
  try {
    const url = new URL(request.url);
    const proposalId = url.pathname.split('/api/proposals/')[1];
    const userId = url.searchParams.get('userId');
    
    if (!proposalId) {
      return createResponse({ error: 'Missing proposal ID' }, 400);
    }
    
    console.log(`Getting proposal with ID: ${proposalId}`);
    
    let query = `
      SELECT 
        p.id, p.text, p.timestamp, p.trending, p.meme_url,
        u.name as author_name, u.id as author_id,
        (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'upvote') as upvotes,
        (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'downvote') as downvotes,
        (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'upvote' AND is_petition = 1) as petition_signatures,
        (SELECT COUNT(DISTINCT pd.user_id) FROM petition_details pd WHERE pd.proposal_id = p.id AND pd.verified = 1) as verified_petitioners
      FROM proposals p
      JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `;
    
    try {
      const proposal = await env.DB.prepare(query).bind(proposalId).first();
      
      if (!proposal) {
        return createResponse({ error: 'Proposal not found' }, 404);
      }
      
      // If we have a userId, get their votes for this proposal
      if (userId) {
        try {
          const votesQuery = `
            SELECT proposal_id, vote_type, is_petition
            FROM votes
            WHERE user_id = ? AND proposal_id = ?
          `;
          
          const vote = await env.DB.prepare(votesQuery).bind(userId, proposalId).first();
          
          if (vote) {
            proposal.userVote = vote.vote_type;
            proposal.userPetitionSigned = vote.is_petition === 1;
          } else {
            proposal.userVote = null;
            proposal.userPetitionSigned = false;
          }
          
          // Also get petition details status
          const petitionQuery = `
            SELECT proposal_id, verified
            FROM petition_details
            WHERE user_id = ? AND proposal_id = ?
          `;
          
          const petition = await env.DB.prepare(petitionQuery).bind(userId, proposalId).first();
          
          if (petition) {
            proposal.userPetitionVerified = petition.verified === 1;
          } else {
            proposal.userPetitionVerified = false;
          }
        } catch (voteError) {
          // Just log the error but continue - we'll return the proposal without vote data
          logError(voteError, { 
            action: 'get_user_votes', 
            userId, 
            proposalId 
          });
          console.log('Warning: Failed to retrieve user votes, continuing without vote data');
        }
      }
      
      return createResponse(proposal);
    } catch (dbError) {
      return createResponse({ 
        error: 'Failed to retrieve proposal', 
        details: logError(dbError, { action: 'get_proposal_by_id', proposalId, query })
      }, 500);
    }
  } catch (error) {
    return createResponse({ 
      error: 'Failed to process proposal request', 
      details: logError(error, { action: 'get_proposal_by_id_outer' })
    }, 500);
  }
}

async function generateAndStoreShareImage(proposal, env) {
  try {
    // Check if we have the necessary bindings
    if (!env.MEMES_BUCKET) {
      console.error('Missing MEMES_BUCKET binding');
      return null;
    }
    
    // Get base text for the image
    const text = proposal.text || "Unknown petition";
    const authorName = proposal.author_name || "Anonymous";
    
    // Instead of using Cloudinary, let's use our SVG generation which we know works
    const imageId = `share_${proposal.id}`;
    const fallbackImageUrl = "https://theradicalparty.com/memes/petition-template.png";
    
    // Create a simple text-based SVG directly
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
      <rect width="1200" height="630" fill="#000000" />
      <rect x="20" y="20" width="1160" height="590" fill="#111111" stroke="#ff0099" stroke-width="2" />
      <text x="600" y="100" font-family="Arial, sans-serif" font-size="60" fill="#ff0099" text-anchor="middle">RADICAL</text>
      <text x="600" y="180" font-family="Arial, sans-serif" font-size="40" fill="#ffffff" text-anchor="middle" width="1000">${text.substring(0, 80)}</text>
      <text x="600" y="550" font-family="Arial, sans-serif" font-size="24" fill="#aaaaaa" text-anchor="middle">by ${authorName}</text>
    </svg>`;
    
    // Convert SVG to a blob
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml' });
    
    // Upload the SVG to R2
    try {
      await env.MEMES_BUCKET.put(imageId, svgBlob, {
        httpMetadata: {
          contentType: 'image/svg+xml',
        },
      });
      
      // Generate the public URL for the stored image
      const shareImageUrl = `https://theradicalparty.com/memes/${imageId}`;
      console.log(`Created share image at: ${shareImageUrl}`);
      return shareImageUrl;
    } catch (uploadError) {
      console.error('Error uploading share image:', uploadError);
      return fallbackImageUrl;
    }
  } catch (error) {
    console.error('Error in share image generation:', error);
    // Return a fallback image URL in case of failure
    return "https://theradicalparty.com/memes/petition-template.png";
  }
}

// Create a new proposal
async function createProposal(request, env) {
  try {
    // Log request details for debugging
    console.log(`Received proposal creation request at ${Date.now()}`);
    
    // Check if DB binding exists
    if (!env.DB) {
      console.error('Database binding is missing');
      return createResponse({ 
        error: 'Database configuration error', 
        details: 'Database binding is not available' 
      }, 500);
    }

    // Parse request data
    let data;
    try {
      data = await request.json();
      console.log(`Parsed request data: ${JSON.stringify(data)}`);
    } catch (parseError) {
      console.error('Failed to parse request JSON:', parseError);
      return createResponse({ 
        error: 'Invalid request format', 
        details: 'Could not parse JSON body' 
      }, 400);
    }
    
    const { text, authorId, trending = false } = data;
    
    // Validate required fields
    if (!text || !authorId) {
      console.error('Missing required fields:', { text: !!text, authorId: !!authorId });
      return createResponse({ 
        error: 'Missing required fields', 
        received: { text: text ? 'present' : 'missing', authorId: authorId ? 'present' : 'missing' } 
      }, 400);
    }
    
    // Check if user exists first
    try {
      console.log(`Checking if user exists: ${authorId}`);
      const userCheck = await env.DB.prepare(`SELECT id, name FROM users WHERE id = ?`).bind(authorId).first();
      
      if (!userCheck) {
        console.error(`User not found: ${authorId}`);
        return createResponse({ 
          error: 'Author does not exist', 
          authorId,
          suggestion: 'Create the user first before posting a proposal' 
        }, 400);
      }
      
      console.log(`User found: ${userCheck.id}, ${userCheck.name}`);
      
      // Create a temporary proposal object with author name for image generation
      const id = 'proposal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
      const timestamp = Date.now();
      
      console.log(`Generated proposal ID: ${id}`);
      
      // Create temporary proposal object
      const tempProposal = {
        id: id,
        text: text,
        author_name: userCheck.name
      };
      
      // Insert the proposal first
      console.log('Inserting proposal into database');
      const query = `
        INSERT INTO proposals (id, author_id, text, timestamp, trending)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      try {
        await env.DB.prepare(query)
          .bind(id, authorId, text, timestamp, trending ? 1 : 0)
          .run();
        
        console.log('Proposal inserted successfully');
      } catch (insertError) {
        console.error('Database insertion error:', insertError);
        return createResponse({ 
          error: 'Failed to insert proposal into database', 
          details: logError(insertError, { action: 'insert_proposal' })
        }, 500);
      }
      
      // Generate and store the share image (but don't block on it)
      console.log('Generating share image');
      let shareImageUrl = null;
      
      try {
        shareImageUrl = await generateAndStoreShareImage(tempProposal, env);
        console.log(`Generated share image: ${shareImageUrl}`);
        
        // Update the proposal with the share image URL if we got one
        if (shareImageUrl) {
          console.log('Updating proposal with share image URL');
          await env.DB.prepare(`
            UPDATE proposals
            SET share_image_url = ?
            WHERE id = ?
          `).bind(shareImageUrl, id).run();
        }
      } catch (imageError) {
        // Log but don't fail the whole request if image generation fails
        console.error('Image generation error (non-fatal):', imageError);
      }
      
      console.log(`Successfully created proposal with ID: ${id}`);
      
      // Return success response with created proposal data
      return createResponse({ 
        id, 
        authorId, 
        text, 
        timestamp, 
        trending,
        shareImageUrl 
      });
    } catch (userCheckError) {
      console.error('Error checking user existence:', userCheckError);
      return createResponse({ 
        error: 'Failed to verify user', 
        details: logError(userCheckError, { action: 'check_user', authorId })
      }, 500);
    }
  } catch (error) {
    console.error('Unhandled error in proposal creation:', error);
    return createResponse({ 
      error: 'Failed to process proposal creation', 
      details: logError(error, { action: 'create_proposal_outer' })
    }, 500);
  }
}

// Update a proposal (e.g., mark as trending)
async function updateProposal(id, request, env) {
  try {
    const data = await request.json();
    const { trending } = data;
    
    console.log(`Updating proposal ${id}: ${JSON.stringify(data)}`);
    
    if (trending === undefined) {
      return createResponse({ error: 'No fields to update', received: data }, 400);
    }
    
    // Check if proposal exists
    try {
      const proposalCheck = await env.DB.prepare(`SELECT id FROM proposals WHERE id = ?`).bind(id).first();
      if (!proposalCheck) {
        return createResponse({ error: 'Proposal does not exist', id }, 404);
      }
    } catch (checkError) {
      return createResponse({ 
        error: 'Error checking proposal existence', 
        details: logError(checkError, { action: 'check_proposal', id })
      }, 500);
    }
    
    const query = `
      UPDATE proposals
      SET trending = ?
      WHERE id = ?
    `;
    
    try {
      await env.DB.prepare(query).bind(trending ? 1 : 0, id).run();
      console.log(`Successfully updated proposal ${id} trending status to ${trending}`);
      
      return createResponse({ id, trending });
    } catch (dbError) {
      return createResponse({ 
        error: 'Failed to update proposal', 
        details: logError(dbError, { action: 'update_proposal', id, trending }) 
      }, 500);
    }
  } catch (error) {
    return createResponse({ 
      error: 'Failed to process proposal update', 
      details: logError(error, { action: 'update_proposal_outer', id }) 
      }, 500);
  }
}

// Create or update a vote and handle petition data
async function createOrUpdateVote(request, env) {
  try {
    const data = await request.json();
    const { proposalId, userId, voteType, isPetition = false, petitionDetails = null } = data;
    
    console.log(`Processing vote/petition: ${JSON.stringify({
      proposalId, 
      userId, 
      voteType, 
      isPetition,
      hasDetails: petitionDetails !== null
    })}`);
    
    if (!proposalId || !userId || !voteType) {
      return createResponse({ 
        error: 'Missing required fields', 
        received: { proposalId, userId, voteType: voteType || 'undefined' } 
      }, 400);
    }
    
    if (voteType !== 'upvote' && voteType !== 'downvote') {
      return createResponse({ 
        error: 'Invalid vote type', 
        voteType, 
        allowedValues: ['upvote', 'downvote'] 
      }, 400);
    }
    
    // Check if entities exist
    try {
      const userCheck = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
      if (!userCheck) {
        return createResponse({ error: 'User does not exist', userId }, 404);
      }
      
      const proposalCheck = await env.DB.prepare(`SELECT id FROM proposals WHERE id = ?`).bind(proposalId).first();
      if (!proposalCheck) {
        return createResponse({ error: 'Proposal does not exist', proposalId }, 404);
      }
    } catch (checkError) {
      return createResponse({ 
        error: 'Error checking user or proposal existence', 
        details: logError(checkError, { action: 'check_entities', userId, proposalId })
      }, 500);
    }
    
    // Check if vote already exists
    let existingVote;
    try {
      const checkQuery = `
        SELECT id, vote_type, is_petition FROM votes
        WHERE proposal_id = ? AND user_id = ?
      `;
      
      existingVote = await env.DB.prepare(checkQuery).bind(proposalId, userId).first();
      console.log(`Existing vote check: ${existingVote ? JSON.stringify(existingVote) : 'None found'}`);
    } catch (voteCheckError) {
      return createResponse({ 
        error: 'Error checking existing vote', 
        details: logError(voteCheckError, { action: 'check_vote', userId, proposalId })
      }, 500);
    }
    
    const timestamp = Date.now();
    
    try {
      // Process vote
      if (existingVote) {
        // If vote exists and it's the same type, remove it (toggle off)
        if (existingVote.vote_type === voteType) {
          await env.DB.prepare(`
            DELETE FROM votes
            WHERE id = ?
          `).bind(existingVote.id).run();
          
          console.log(`Deleted vote ${existingVote.id} (toggle off)`);
          
          return createResponse({ proposalId, userId, voteType: null });
        } else {
          // If vote exists but is different type, update it
          await env.DB.prepare(`
            UPDATE votes
            SET vote_type = ?, timestamp = ?, is_petition = ?
            WHERE id = ?
          `).bind(
            voteType, 
            timestamp, 
            voteType === 'upvote' && isPetition ? 1 : 0, 
            existingVote.id
          ).run();
          
          console.log(`Updated vote ${existingVote.id} to ${voteType}`);
        }
      } else {
        // If no vote exists, create new one
        const result = await env.DB.prepare(`
          INSERT INTO votes (proposal_id, user_id, vote_type, timestamp, is_petition)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          proposalId, 
          userId, 
          voteType, 
          timestamp,
          voteType === 'upvote' && isPetition ? 1 : 0
        ).run();
        
        console.log(`Created new vote with ID: ${result.meta?.last_row_id || 'unknown'}`);
      }
      
      // Process petition details if provided
      if (voteType === 'upvote' && isPetition && petitionDetails) {
        try {
          // Validate petition details
          const { fullName, address, postcode, dob, email } = petitionDetails;
          
          if (!fullName || !address || !postcode || !dob || !email) {
            return createResponse({ error: 'Missing required petition details' }, 400);
          }
          
          // Check if petition details already exist
          const petitionCheck = await env.DB.prepare(`
            SELECT id FROM petition_details
            WHERE user_id = ? AND proposal_id = ?
          `).bind(userId, proposalId).first();
          
          if (!petitionCheck) {
            // Store petition details
            await env.DB.prepare(`
              INSERT INTO petition_details 
              (user_id, proposal_id, full_name, address, postcode, dob, email, timestamp, verified)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              userId, 
              proposalId, 
              fullName, 
              address, 
              postcode, 
              dob, 
              email, 
              timestamp,
              1 // Assuming verification was successful
            ).run();
            
            console.log(`Stored petition details for user ${userId} on proposal ${proposalId}`);
          } else {
            // Update existing petition details
            await env.DB.prepare(`
              UPDATE petition_details
              SET full_name = ?, address = ?, postcode = ?, dob = ?, email = ?, timestamp = ?, verified = ?
              WHERE user_id = ? AND proposal_id = ?
            `).bind(
              fullName,
              address,
              postcode,
              dob,
              email,
              timestamp,
              1, // Assuming verification was successful
              userId,
              proposalId
            ).run();
            
            console.log(`Updated petition details for user ${userId} on proposal ${proposalId}`);
          }
        } catch (petitionError) {
          return createResponse({ 
            error: 'Failed to process petition details', 
            details: logError(petitionError, { action: 'store_petition', userId, proposalId })
          }, 500);
        }
      }
      
      return createResponse({ 
        proposalId, 
        userId, 
        voteType,
        isPetition: voteType === 'upvote' && isPetition,
        petitionVerified: voteType === 'upvote' && isPetition
      });
    } catch (dbError) {
      return createResponse({ 
        error: 'Failed to process vote/petition in database', 
        details: logError(dbError, { 
          action: 'process_vote_petition', 
          existingVote: existingVote || null,
          newVote: { proposalId, userId, voteType, isPetition }
        })
      }, 500);
    }
  } catch (error) {
    return createResponse({ 
      error: 'Failed to process vote/petition request', 
      details: logError(error, { action: 'vote_petition_outer' })
    }, 500);
  }
}

// 3. Update the getComments function to include vote counts
async function getComments(request, env) {
  try {
    const url = new URL(request.url);
    const proposalId = url.searchParams.get('proposalId');
    const userId = url.searchParams.get('userId');
    
    if (!proposalId) {
      return createResponse({ error: 'Missing proposalId parameter' }, 400);
    }
    
    const query = `
      SELECT 
        c.id, c.user_id, c.comment_text, c.timestamp,
        u.name as user_name,
        (SELECT COUNT(*) FROM comment_votes WHERE comment_id = c.id AND vote_type = 'upvote') as upvotes,
        (SELECT COUNT(*) FROM comment_votes WHERE comment_id = c.id AND vote_type = 'downvote') as downvotes
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.proposal_id = ?
      ORDER BY c.timestamp DESC
    `;
    
    try {
      const comments = await env.DB.prepare(query).bind(proposalId).all();
      console.log(`Retrieved ${comments.results.length} comments for proposal ${proposalId}`);
      
      // If userId is provided, get the user's votes for these comments
      if (userId && comments.results.length > 0) {
        const commentIds = comments.results.map(c => c.id);
        
        // Build placeholders for the SQL query
        let placeholders = commentIds.map(() => '?').join(',');
        
        const votesQuery = `
          SELECT comment_id, vote_type 
          FROM comment_votes 
          WHERE user_id = ? AND comment_id IN (${placeholders})
        `;
        
        // Prepare bind parameters
        const bindParams = [userId, ...commentIds];
        
        const votes = await env.DB.prepare(votesQuery).bind(...bindParams).all();
        
        // Create a map of commentId to vote type
        const voteMap = {};
        votes.results.forEach(vote => {
          voteMap[vote.comment_id] = vote.vote_type;
        });
        
        // Add user's vote to each comment
        comments.results.forEach(comment => {
          comment.userVote = voteMap[comment.id] || null;
        });
      }
      
      return createResponse(comments.results);
    } catch (dbError) {
      return createResponse({
        error: 'Failed to retrieve comments',
        details: logError(dbError, { action: 'get_comments', proposalId })
      }, 500);
    }
  } catch (error) {
    return createResponse({
      error: 'Failed to process comments request',
      details: logError(error, { action: 'get_comments_outer' })
    }, 500);
  }
}

// Function to create a new comment
async function createComment(request, env) {
  console.log("========== BEGIN createComment ==========");
  try {
    // First check if request is properly formed
    if (!request || !request.body) {
      console.error("Invalid request object or missing body");
      return createResponse({
        error: 'Invalid request',
        details: 'Request missing required properties'
      }, 400);
    }
    
    // Attempt to parse JSON data
    let data;
    try {
      data = await request.json();
      console.log(`Parsed comment request data: ${JSON.stringify(data)}`);
    } catch (jsonError) {
      console.error("Failed to parse request JSON:", jsonError);
      return createResponse({
        error: 'Invalid JSON in request',
        details: 'Could not parse request body as JSON'
      }, 400);
    }
    
    const { proposalId, userId, commentText } = data;
    
    console.log(`Creating comment: proposalId=${proposalId}, userId=${userId}, text length=${commentText?.length || 0}`);
    
    if (!proposalId || !userId || !commentText) {
      console.error("Missing required fields:", {
        hasProposalId: !!proposalId,
        hasUserId: !!userId,
        hasCommentText: !!commentText
      });
      
      return createResponse({
        error: 'Missing required fields',
        received: { 
          proposalId: proposalId || '[missing]', 
          userId: userId || '[missing]', 
          commentText: commentText ? '[present]' : '[missing]' 
        }
      }, 400);
    }
    
    // Check if proposal exists
    try {
      console.log(`Checking if proposal exists: ${proposalId}`);
      const proposalCheck = await env.DB.prepare(
        `SELECT id FROM proposals WHERE id = ?`
      ).bind(proposalId).first();
      
      if (!proposalCheck) {
        console.error(`Proposal not found: ${proposalId}`);
        return createResponse({ 
          error: 'Proposal does not exist', 
          proposalId 
        }, 404);
      }
      
      console.log(`Proposal found: ${proposalCheck.id}`);
    } catch (checkError) {
      console.error("Error checking proposal existence:", checkError);
      return createResponse({
        error: 'Error checking proposal existence',
        details: logError(checkError, { action: 'check_proposal', proposalId })
      }, 500);
    }
    
    // Check if user exists
    try {
      console.log(`Checking if user exists: ${userId}`);
      const userCheck = await env.DB.prepare(
        `SELECT id FROM users WHERE id = ?`
      ).bind(userId).first();
      
      if (!userCheck) {
        console.error(`User not found: ${userId}`);
        return createResponse({ 
          error: 'User does not exist', 
          userId 
        }, 404);
      }
      
      console.log(`User found: ${userCheck.id}`);
    } catch (userError) {
      console.error("Error checking user existence:", userError);
      return createResponse({
        error: 'Error checking user existence',
        details: logError(userError, { action: 'check_user', userId })
      }, 500);
    }
    
    // Generate a unique comment ID
    const id = 'comment_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const timestamp = Date.now();
    
    console.log(`Generated comment ID: ${id}`);
    
    // Insert the comment into the database
    try {
      console.log("Inserting comment into database");
      await env.DB.prepare(`
        INSERT INTO comments (id, proposal_id, user_id, comment_text, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).bind(id, proposalId, userId, commentText, timestamp).run();
      
      console.log(`Successfully created comment with ID: ${id}`);
      
      // Get user name for response
      console.log("Getting user name for response");
      const userQuery = await env.DB.prepare(
        `SELECT name FROM users WHERE id = ?`
      ).bind(userId).first();
      
      if (!userQuery || !userQuery.name) {
        console.warn(`Could not find name for user ${userId}, using 'Anonymous'`);
      }
      
      const responseData = {
        id,
        proposalId,
        userId,
        userName: userQuery?.name || 'Anonymous',
        commentText,
        timestamp,
        upvotes: 0,
        downvotes: 0
      };
      
      console.log(`Creating successful response: ${JSON.stringify(responseData)}`);
      console.log("========== END createComment ==========");
      
      return createResponse(responseData, 201);  // Use 201 Created for successful creation
    } catch (dbError) {
      console.error("Database error creating comment:", dbError);
      return createResponse({
        error: 'Failed to create comment in database',
        details: logError(dbError, {
          action: 'insert_comment',
          comment: { id, proposalId, userId, timestamp }
        })
      }, 500);
    }
  } catch (error) {
    console.error("Unhandled error in createComment:", error);
    console.log("========== END createComment (with error) ==========");
    return createResponse({
      error: 'Failed to process comment creation',
      details: logError(error, { action: 'create_comment_outer' })
    }, 500);
  }
}

// Create or get a user
async function createOrGetUser(request, env) {
  try {
    const data = await request.json();
    const { id, name } = data;
    
    console.log(`Processing user request: ${JSON.stringify(data)}`);
    
    if (!id || !name) {
      return createResponse({ 
        error: 'Missing required fields', 
        received: { id: id || 'undefined', name: name || 'undefined' } 
      }, 400);
    }
    
    // Check if user exists
    let existingUser;
    try {
      const checkQuery = `
        SELECT id, name FROM users
        WHERE id = ?
      `;
      
      existingUser = await env.DB.prepare(checkQuery).bind(id).first();
      console.log(`Existing user check: ${existingUser ? JSON.stringify(existingUser) : 'None found'}`);
    } catch (userCheckError) {
      return createResponse({ 
        error: 'Error checking user existence', 
        details: logError(userCheckError, { action: 'check_user', id })
      }, 500);
    }
    
    if (!existingUser) {
      try {
        // Create new user if doesn't exist
        const timestamp = Date.now();
        const insertQuery = `
          INSERT INTO users (id, name, created_at)
          VALUES (?, ?, ?)
        `;
        await env.DB.prepare(insertQuery).bind(id, name, timestamp).run();
        console.log(`Created new user with ID: ${id}`);
      } catch (insertError) {
        return createResponse({ 
          error: 'Failed to create user', 
          details: logError(insertError, { action: 'insert_user', user: { id, name } })
        }, 500);
      }
    } else {
      console.log(`Found existing user: ${existingUser.id}`);
    }
    
    return createResponse({ id, name });
  } catch (error) {
    return createResponse({ 
      error: 'Failed to process user request', 
      details: logError(error, { action: 'user_outer' })
    }, 500);
  }
}

async function verifyTemplateImage(env) {
  try {
    const key = "petition-template.png";
    const object = await env.MEMES_BUCKET.get(key);
    
    if (object === null) {
      console.error("❌ Template image not found in R2 bucket!");
      return false;
    }
    
    console.log("✅ Template image found in R2 bucket");
    return true;
  } catch (error) {
    console.error("Error verifying template image:", error);
    return false;
  }
}

/**
 * Handle requests for dynamic SVG images for petitions
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @returns {Response} - SVG response
 */
async function servePetitionSVG(request, env) {
  try {
    const url = new URL(request.url);
    const proposalId = url.searchParams.get('id');
    
    if (!proposalId) {
      return new Response('Missing proposal ID', { status: 400 });
    }
    
    console.log(`Generating SVG image for proposal: ${proposalId}`);
    
    // Fetch the proposal data from the database
    const proposal = await env.DB.prepare(`
      SELECT 
        p.id, p.text, p.timestamp,
        u.name as author_name,
        (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'upvote') as upvotes,
        (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'downvote') as downvotes
      FROM proposals p
      JOIN users u ON p.author_id = u.id
      WHERE p.id = ?
    `).bind(proposalId).first();
    
    if (!proposal) {
      return new Response('Proposal not found', { status: 404 });
    }
    
    // Generate the SVG
    const svgMarkup = generatePetitionSVG(proposal);
    
    // Return the SVG with appropriate headers
    return new Response(svgMarkup, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=360000', // Cache for 1 hour
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    console.error('Error generating petition SVG:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * Generates a dynamic SVG for a petition with the given data
 * @param {Object} proposal - The petition/proposal data
 * @returns {string} - SVG markup as a string
 */
function generatePetitionSVG(proposal) {
  // Get data with fallbacks
  const petitionText = proposal.text || "Unknown petition";
  const upvotes = proposal.upvotes || 0;
  const downvotes = proposal.downvotes || 0;
  const netVotes = upvotes - downvotes;
  const netVotesDisplay = netVotes > 0 ? `+${netVotes}` : netVotes;
  const netVotesColor = netVotes > 0 ? "#11cc77" : (netVotes < 0 ? "#ff0099" : "#ffffff");
  const proposalId = proposal.id || "unknown";
  
  // Format timestamp
  const timestamp = new Date(proposal.timestamp || Date.now()).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  
  // Base SVG template
  const svgTemplate = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <!-- Background -->
  <rect width="1200" height="630" fill="#000000" />
  
  <!-- Border frame with glowing effect -->
  <rect x="10" y="10" width="1180" height="610" fill="none" stroke="#ff0099" stroke-width="4" rx="0" />
  <rect x="20" y="20" width="1160" height="590" fill="rgba(0, 0, 0, 0.8)" stroke="#ff0099" stroke-width="1" rx="0" 
        style="filter: drop-shadow(0 0 10px #ff0099)" />
  
  <!-- RADICAL Header -->
  <text x="600" y="90" font-family="'Roboto Mono', monospace" font-size="72" font-weight="700" text-anchor="middle" 
        fill="#ff0099" style="text-transform: uppercase;">RADICAL</text>
  
  <!-- Tagline -->
  <rect x="450" y="110" width="300" height="36" fill="#ff0099" />
  <text x="600" y="135" font-family="'Roboto Mono', monospace" font-size="20" font-weight="600" text-anchor="middle" 
        fill="#000000" style="text-transform: uppercase;">VIBE, VOTE, VETO</text>
  
  <!-- Petition text container -->
  <rect x="100" y="180" width="1000" height="280" fill="rgba(17, 17, 17, 0.7)" stroke="#333333" stroke-width="1" />
  
  <!-- Petition text (dynamically generated) -->
  ${generateSVGTextLines(petitionText, 120, 220, 960)}
  
  <!-- Vote statistics -->
  <g transform="translate(200, 510)">
    <!-- Upvotes -->
    <text x="0" y="0" font-family="'Roboto Mono', monospace" font-size="24" fill="#ff0099">▲</text>
    <text x="30" y="0" font-family="'Roboto Mono', monospace" font-size="24" fill="#ffffff">${upvotes}</text>
    
    <!-- Downvotes -->
    <text x="120" y="0" font-family="'Roboto Mono', monospace" font-size="24" fill="#ff0099">▼</text>
    <text x="150" y="0" font-family="'Roboto Mono', monospace" font-size="24" fill="#ffffff">${downvotes}</text>
    
    <!-- Net votes -->
    <text x="240" y="0" font-family="'Roboto Mono', monospace" font-size="24" fill="#ff0099">NET:</text>
    <text x="300" y="0" font-family="'Roboto Mono', monospace" font-size="24" fill="${netVotesColor}">${netVotesDisplay}</text>
  </g>
  
  <!-- Timestamp and ID -->
  <text x="600" y="560" font-family="'Roboto Mono', monospace" font-size="18" fill="#aaaaaa" text-anchor="middle">
    Petition ID: ${proposalId} • Created: ${timestamp}
  </text>
  
  <!-- Radical Logo / Brand (right corner) -->
  <g transform="translate(940, 460)">
    <!-- Pink square for the logo -->
    <rect x="0" y="0" width="120" height="120" fill="#111111" stroke="#ff0099" stroke-width="2" />
    <text x="60" y="50" font-family="'Roboto Mono', monospace" font-size="16" fill="#ffffff" text-anchor="middle">RADICAL</text>
    <text x="60" y="75" font-family="'Roboto Mono', monospace" font-size="14" fill="#ff0099" text-anchor="middle">PETITION</text>
    <text x="60" y="100" font-family="'Roboto Mono', monospace" font-size="12" fill="#aaaaaa" text-anchor="middle">#${proposalId.slice(-6)}</text>
  </g>
  
  <!-- URL -->
  <text x="600" y="600" font-family="'Roboto Mono', monospace" font-size="20" fill="#ff0099" text-anchor="middle" 
        style="text-transform: uppercase;">theradicalparty.com</text>
</svg>`;

  return svgTemplate;
}

/**
 * Generates SVG text elements with proper line wrapping
 * @param {string} text - The text to wrap
 * @param {number} x - Starting x position
 * @param {number} y - Starting y position
 * @param {number} width - Maximum width for text wrapping
 * @returns {string} - SVG text elements
 */
function generateSVGTextLines(text, x, y, width) {
  // Simple word wrapping algorithm
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  
  // Estimate characters per line based on width and average character width
  const avgCharWidth = 22; // Rough estimate for font size ~36px
  const charsPerLine = Math.floor(width / avgCharWidth);
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= charsPerLine) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  // Limit to 6 lines to fit in the container
  const limitedLines = lines.slice(0, 6);
  if (lines.length > 6) {
    // Add ellipsis to the last line if truncated
    limitedLines[5] = limitedLines[5].slice(0, -3) + '...';
  }
  
  // Generate SVG text elements
  const lineHeight = 46;
  let svgTextElements = '';
  
  limitedLines.forEach((line, index) => {
    const lineY = y + index * lineHeight;
    svgTextElements += `<text x="${x}" y="${lineY}" font-family="'Roboto Mono', monospace" font-size="36" fill="#ffffff">${escapeHTML(line)}</text>\n`;
  });
  
  return svgTextElements;
}

/**
 * Escapes HTML special characters in a string
 * @param {string} text - The text to escape
 * @returns {string} - Escaped text
 */
function escapeHTML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Update the getShareableImageUrl function to use the SVG endpoint
function getShareableImageUrl(proposal) {
  // Use the dynamic SVG endpoint with the proposal ID
  return `https://theradicalparty.com/api//petition-svg?id=${proposal.id}`;
}

// Update the serveCustomizedHtml function to use the SVG URL for meta tags
async function serveCustomizedHtml(proposalId, request, env) {
  console.log(`===== BEGIN serveCustomizedHtml for proposal ${proposalId} =====`);
  
  try {
    const url = new URL(request.url);
    const isTestMeta = url.searchParams.get('test_meta') === 'true';
    
    // Determine which proposal to use
    let proposal;
    let shareImageUrl;
    
    if (isTestMeta) {
      // Use test proposal data
      proposal = {
        id: 'test_proposal',
        text: 'This is a test proposal for meta tags',
        timestamp: Date.now(),
        author_name: 'Test User'
      };
      shareImageUrl = `https://${url.hostname}/api/petition-svg?id=test_proposal`;
    } else {
      // Fetch the actual proposal from the database
      proposal = await env.DB.prepare(`
        SELECT 
          p.id, p.text, p.timestamp,
          u.name as author_name
        FROM proposals p
        JOIN users u ON p.author_id = u.id
        WHERE p.id = ?
      `).bind(proposalId).first();
      
      if (!proposal) {
        console.error(`Proposal not found: ${proposalId}`);
        return await fetch(request);
      }
      
      // Generate SVG URL
      shareImageUrl = `https://${url.hostname}/api/petition-svg?id=${proposalId}`;
    }
    
    console.log(`Found proposal: ${JSON.stringify(proposal)}`);
    console.log(`Using share image URL: ${shareImageUrl}`);
    
    // Get the full URL for this proposal
    const fullProposalUrl = `https://${url.hostname}/?proposal=${proposalId}`;
    
    // Fetch the original HTML
    const response = await fetch(request);
    const html = await response.text();
    
    // First, remove all existing og:image and twitter:image tags
    let modifiedHtml = html.replace(/<meta\s+property=["']og:image(:[^"']*)?["'][^>]*>/g, '');
    modifiedHtml = modifiedHtml.replace(/<meta\s+name=["']twitter:image(:[^"']*)?["'][^>]*>/g, '');
    modifiedHtml = modifiedHtml.replace(/<meta\s+name=["']twitter:image:src["'][^>]*>/g, '');
    
    // Find the head end tag
    const headEndIndex = modifiedHtml.indexOf('</head>');
    if (headEndIndex === -1) {
      console.error("Could not find </head> tag in HTML");
      return new Response(modifiedHtml, {
        headers: response.headers
      });
    }
    
    // Create comprehensive meta tags
    const customMetaTags = `
      <!-- RADICAL SOCIAL SHARING META TAGS ${Date.now()} -->
      <!-- Primary Meta Tags -->
      <meta name="title" content="RADICAL Petition: ${proposal.text.substring(0, 60)}">
      <meta name="description" content="${proposal.text.substring(0, 150)}">
      
      <!-- Open Graph / Facebook -->
      <meta property="og:type" content="website">
      <meta property="og:url" content="${fullProposalUrl}">
      <meta property="og:title" content="RADICAL Petition: ${proposal.text.substring(0, 60)}">
      <meta property="og:description" content="${proposal.text.substring(0, 150)}">
      <meta property="og:image" content="${shareImageUrl}">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
      <meta property="og:image:alt" content="RADICAL Petition: ${proposal.text.substring(0, 60)}">
      
      <!-- Twitter -->
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:url" content="${fullProposalUrl}">
      <meta name="twitter:title" content="RADICAL Petition">
      <meta name="twitter:description" content="${proposal.text.substring(0, 150)}">
      <meta name="twitter:image" content="${shareImageUrl}">
      <meta name="twitter:image:alt" content="RADICAL Petition: ${proposal.text.substring(0, 60)}">
    `;
    
    // Insert our meta tags right before </head>
    let customizedHtml = modifiedHtml.substring(0, headEndIndex) + customMetaTags + modifiedHtml.substring(headEndIndex);
    
    console.log(`===== END serveCustomizedHtml for proposal ${proposalId} =====`);
    
    // Return the customized HTML with appropriate headers
    const originalHeaders = new Headers(response.headers);
    originalHeaders.set('Cache-Control', 'no-store, max-age=0');
    originalHeaders.set('X-Custom-Meta', isTestMeta ? 'test' : 'proposal');
    originalHeaders.set('X-Share-Image-Url', shareImageUrl); // Debug header
    
    return new Response(customizedHtml, {
      headers: originalHeaders
    });
  } catch (error) {
    console.error('Error generating customized HTML:', error);
    // Fall back to regular page if something goes wrong
    return await fetch(request);
  }
}