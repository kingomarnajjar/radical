export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Acceptable hostnames
      const validHostnames = [
        'theradicalparty.com', 
        'www.theradicalparty.com',
        'radical.omar-c29.workers.dev'
      ];

      // Check if the hostname is valid
      if (!validHostnames.includes(url.hostname)) {
        console.error(`Unexpected hostname: ${url.hostname}`);
        return new Response('Invalid hostname', { status: 400 });
      }

      const path = url.pathname;
      const proposalId = url.searchParams.get('proposal');

      console.log(`Processing request: ${url.toString()}`);
      console.log(`User-Agent: ${request.headers.get('User-Agent')}`);

      // Handle CORS preflight requests first
      if (request.method === 'OPTIONS') {
        return handleOptions();
      }

      // For GET requests, try to serve from cache first
      if (request.method === "GET") {
        // Create a cache key from the request URL
        const cacheKey = new Request(request.url, {
          headers: request.headers
        });
        
        // Try to get from cache first
        let cachedResponse = await caches.default.match(cacheKey);
        
        if (cachedResponse) {
          // Add header to indicate cache hit
          cachedResponse = new Response(cachedResponse.body, cachedResponse);
          cachedResponse.headers.set("CF-Cache-Status", "HIT");
          
          // Ensure CORS headers are present
          Object.keys(corsHeaders).forEach(key => {
            cachedResponse.headers.set(key, corsHeaders[key]);
          });
          
          return cachedResponse;
        }
      }

      // Handle styles.css route
      if (path === '/styles.css') {
        try {
          // Fetch CSS from GitHub Pages
          const response = await fetch('https://kingomarnajjar.github.io/radical/styles.css', {
            headers: {
              'User-Agent': request.headers.get('User-Agent') || 'Cloudflare Worker'
            }
          });
          
          if (!response.ok) {
            console.error('Failed to fetch styles.css', response.status, response.statusText);
            return new Response('CSS File Not Found', { status: 404 });
          }
          
          // Get the CSS content
          const cssContent = await response.text();
          
          // Return CSS response with caching headers
          const cssResponse = new Response(cssContent, {
            status: 200,
            headers: {
              'Content-Type': 'text/css',
              'Cache-Control': 'public, max-age=86400', // 1 day
              ...corsHeaders // Add CORS headers
            }
          });

          // Store in cache if this is a GET request
          if (request.method === "GET") {
            const cacheKey = new Request(request.url, {
              headers: request.headers
            });
            ctx.waitUntil(caches.default.put(cacheKey, cssResponse.clone()));
          }
          
          return cssResponse;
        } catch (error) {
          console.error('Error fetching styles.css:', error);
          return new Response('Internal Server Error', { status: 500 });
        }
      }

      const isTestMeta = url.searchParams.get('test_meta') === 'true';

      // Handle root path and index.html with potential meta tag testing
      if (path === '/' || path === '/index.html') {
        // If test_meta is true or there's a proposal, use customization
        if (isTestMeta || proposalId) {
          return await serveCustomizedHtml(proposalId || 'test_proposal', request, env);
        }
        
        // Otherwise, serve main page normally
        return await serveMainPage(request, env);
      }

      if (path === '/api/petition-svg') {
        return await servePetitionSVG(request, env);
      }
      
      // Meta tag testing
      if (url.searchParams.get('test_meta') === 'true') {
        console.log('Meta tag test detected');
        
        // If there's a proposal during meta test, use customization
        if (proposalId && (path === '/' || path === '/index.html')) {
          console.log(`Detected proposal in URL during meta test: ${proposalId}`);
          return await serveCustomizedHtml(proposalId, request, env);
        }
      }
      
      console.log(`Received ${request.method} request to ${path}`);
      
      // Check if the DB binding exists
      if (!env.DB) {
        console.error('DB binding is missing! Check your wrangler.toml configuration.');
        return createResponse({ 
          error: 'Database configuration error. Missing DB binding.',
          hint: 'Check your wrangler.toml file and make sure the DB binding is correctly set up.'
        }, 500);
      }

      // Handle media files (memes and audio)
      if (path.startsWith('/memes/') || path.startsWith('/audio/')) {
        const mediaResponse = await serveMedia(request, env);
        
        // Cache media responses for GET requests
        if (request.method === "GET") {
          const cacheKey = new Request(request.url, {
            headers: request.headers
          });
          
          // Clone the response before modifying
          const responseToCache = new Response(mediaResponse.body, mediaResponse);
          
          // Cache media files for 7 days
          responseToCache.headers.set('Cache-Control', 'public, max-age=604800');
          
          ctx.waitUntil(caches.default.put(cacheKey, responseToCache.clone()));
        }
        
        return mediaResponse;
      } else if (path === '/api/memes' && request.method === 'POST') {
        return await uploadMeme(request, env);
      }
      
      // Route requests to appropriate handlers
      let response;
      
      if (path === '/api/health') {
        response = await healthCheck(env);
      } else if (path === '/api/debug-meta') {
        response = await debugMetaTags(request, env);
      } else if (path === '/login' || path === '/login.html') {
        response = await serveLoginPage(request, env);
      } else if (path === '/api/login' && request.method === 'POST') {
        response = await validateLogin(request, env);
      } else if (path === '/api/proposals' && request.method === 'GET') {
        response = await getProposals(request, env);
      } else if (path === '/api/proposals' && request.method === 'POST') {
        response = await createProposal(request, env);
      } else if (path.startsWith('/api/proposals/') && request.method === 'GET') {
        response = await getProposalById(request, env);
      } else if (path.startsWith('/api/proposals/') && request.method === 'PUT') {
        const id = path.split('/').pop();
        response = await updateProposal(id, request, env);
      } else if (path === '/api/votes' && request.method === 'POST') {
        response = await createOrUpdateVote(request, env);
      } else if (path === '/api/users' && request.method === 'POST') {
        response = await createOrGetUser(request, env);
      } else if (path === '/api/petition-stats' && request.method === 'GET') {
        response = await getPetitionStats(request, env);
      } else if (path === '/api/comments' && request.method === 'GET') {
        response = await getComments(request, env);
      } else if (path === '/api/comments' && request.method === 'POST') {
        response = await createComment(request, env);
      } else if (path === '/api/comment-votes' && request.method === 'POST') {
        response = await createOrUpdateCommentVote(request, env);
      } else if (path === '/api/comment-votes' && request.method === 'GET') {
        response = await getCommentVotes(request, env);
      } else {
        response = createResponse({ 
          error: 'Not found', 
          path,
          method: request.method,
          availableRoutes: [
            { path: '/api/health', method: 'GET', description: 'Check system health' },
            { path: '/api/proposals', method: 'GET', description: 'Get proposals' },
            { path: '/api/proposals/:id', method: 'GET', description: 'Get a single proposal by ID' },
            { path: '/api/proposals/:id', method: 'PUT', description: 'Update proposal' },
            { path: '/api/votes', method: 'POST', description: 'Create/update vote' },
            { path: '/api/users', method: 'POST', description: 'Create/get user' },
            { path: '/api/petition-stats', method: 'GET', description: 'Get petition statistics' }
          ]
        }, 404);
      }

      // Cache certain GET responses
      if (request.method === "GET") {
        const shouldCache = path.startsWith('/api/proposals') || 
                           path.startsWith('/api/comments') || 
                           path === '/api/petition-stats' ||
                           path === '/api/health';
        
        if (shouldCache && response) {
          // We need to clone the response before reading its body
          const responseToCache = new Response(response.body, response);
          
          // Set appropriate cache duration based on endpoint
          let cacheDuration = 300; // 5 minutes default for API
          if (path === '/api/health') {
            cacheDuration = 3600; // 1 hour for health checks
          }
          
          responseToCache.headers.set('Cache-Control', `public, max-age=${cacheDuration}`);
          responseToCache.headers.set('CF-Cache-Status', 'MISS');
          
          // Ensure all CORS headers are present
          Object.keys(corsHeaders).forEach(key => {
            responseToCache.headers.set(key, corsHeaders[key]);
          });
          
          const cacheKey = new Request(request.url, {
            headers: request.headers
          });
          
          ctx.waitUntil(caches.default.put(cacheKey, responseToCache.clone()));
          
          // Make sure the response we return also has CORS headers
          Object.keys(corsHeaders).forEach(key => {
            response.headers.set(key, corsHeaders[key]);
          });
        }
      }
      
      return response;
      
    } catch (error) {
      console.error('Critical error in request handling:', error);
      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        details: error.message
      }), { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders // Add CORS headers to error responses too
        }
      });
    }
  }
};


async function serveMainPage(request, env) {
  try {
    // Fetch from GitHub Pages
    const response = await fetch('https://kingomarnajjar.github.io/radical/index.html', {
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
    const response = await fetch('https://kingomarnajjar.github.io/radical/login.html', {
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
    const memeUrl = `https://radical.omar-c29.workers.dev/memes/${uniqueFilename}`;
    
    // Helper function to fix broken meme URLs
    function fixMemeUrl(url) {
      // Check if the URL contains the problematic domain
      if (url && url.includes('memes.undefined')) {
        // Extract the filename from the URL
        const filename = url.split('/').pop();
        // Replace with the correct domain
        return `https://radical.omar-c29.workers.dev/memes/${filename}`;
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
}// Get petition statistics
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
}// Define CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

// Handle OPTIONS request for CORS preflight
function handleOptions() {
  return new Response(null, {
    headers: corsHeaders
  });
}

// Helper to create standardized responses
function createResponse(body, status = 200, cacheDuration = 60*60*24) {
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders
  };
  
  if (cacheDuration > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheDuration}`;
    headers['CDN-Cache-Control'] = `public, max-age=${cacheDuration}`;
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
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
  return `https://${new URL(request.url).hostname}/api/petition-svg?id=${proposal.id}`;
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
    const url = new URL(request.url);
    const sortBy = url.searchParams.get('sortBy') || 'newest';
    
    // Log request details
    console.log(`Getting proposals with sort: ${sortBy}`);
    
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
      query += ' ORDER BY p.timestamp DESC';
    } else if (sortBy === 'popular') {
      query += ` 
        ORDER BY (
          (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'upvote') -
          (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'downvote')
        ) DESC
      `;
    } else if (sortBy === 'controversial') {
      query += ` 
        ORDER BY (
          (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'upvote') +
          (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'downvote')
        ) DESC
      `;
    } else if (sortBy === 'petitions') {
      // New sorting option for most petitioned
      query += `
        ORDER BY (
          (SELECT COUNT(*) FROM votes WHERE proposal_id = p.id AND vote_type = 'upvote' AND is_petition = 1)
        ) DESC
      `;
    }
    
    console.log(`Executing query: ${query}`);
    
    // Get user ID for checking existing votes
    const userId = url.searchParams.get('userId');
    let proposals;
    
    try {
      proposals = await env.DB.prepare(query).all();
      console.log(`Retrieved ${proposals.results.length} proposals`);
    } catch (dbError) {
      return createResponse({ 
        error: 'Failed to retrieve proposals', 
        details: logError(dbError, { action: 'get_proposals', query })
      }, 500);
    }
    
    // If we have a userId, get their votes for these proposals
    if (userId && proposals.results.length > 0) {
      const proposalIds = proposals.results.map(p => p.id);
      
      try {
        // Use parameter binding with placeholders
        let placeholderStr = '';
        for (let i = 0; i < proposalIds.length; i++) {
          placeholderStr += (i === 0 ? '?' : ',?');
        }
        
        const votesQuery = `
          SELECT proposal_id, vote_type, is_petition
          FROM votes
          WHERE user_id = ? AND proposal_id IN (${placeholderStr})
        `;
        
        console.log(`Executing votes query for user ${userId} with ${proposalIds.length} proposals`);
        
        const bindParams = [userId, ...proposalIds];
        const votes = await env.DB.prepare(votesQuery).bind(...bindParams).all();
        
        console.log(`Retrieved ${votes.results.length} votes for user ${userId}`);
        
        // Create a map of proposal_id to vote info
        const voteMap = {};
        for (const vote of votes.results) {
          voteMap[vote.proposal_id] = {
            voteType: vote.vote_type,
            isPetition: vote.is_petition === 1
          };
        }
        
        // Also get petition details status
        const petitionQuery = `
          SELECT proposal_id, verified
          FROM petition_details
          WHERE user_id = ? AND proposal_id IN (${placeholderStr})
        `;
        
        const petitionDetails = await env.DB.prepare(petitionQuery).bind(...bindParams).all();
        const petitionMap = {};
        
        for (const petition of petitionDetails.results) {
          petitionMap[petition.proposal_id] = {
            verified: petition.verified === 1
          };
        }
        
        // Add user's vote and petition status to each proposal
        for (const proposal of proposals.results) {
          const voteInfo = voteMap[proposal.id];
          proposal.userVote = voteInfo ? voteInfo.voteType : null;
          proposal.userPetitionSigned = voteInfo ? voteInfo.isPetition : false;
          proposal.userPetitionVerified = petitionMap[proposal.id] ? petitionMap[proposal.id].verified : false;
        }
      } catch (voteError) {
        // Just log the error but continue - we'll return proposals without vote data
        logError(voteError, { 
          action: 'get_user_votes', 
          userId, 
          proposalCount: proposalIds.length 
        });
        console.log('Warning: Failed to retrieve user votes, continuing without vote data');
      }
    }
    
    return createResponse(proposals.results);
  } catch (error) {
    return createResponse({ 
      error: 'Failed to process proposals request', 
      details: logError(error, { action: 'get_proposals_outer' })
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
    // Get base text for the image
    const text = proposal.text || "Unknown petition";
    const authorName = proposal.author_name || "Anonymous";
    
    // Create Cloudinary URL for transformation
    const cloudinaryUrl = "https://res.cloudinary.com/dh8apmjya/image/fetch";
    
    // Encode text for URL parameters
    const encodedText = encodeURIComponent(text.substring(0, 80))
      .replace(/'/g, '%27')
      .replace(/"/g, '%22');
    
    // Create transformation parameters
    const params = `b_black,w_1200,h_630,c_fill/l_text:Arial_32_bold:${encodedText},co_white,w_1000,c_fit,g_center`;
    
    // Template image URL
    const templateUrl = encodeURIComponent("https://radical.omar-c29.workers.dev/memes/petition-template.png");
    
    // Create a unique identifier for this image
    const imageId = `share_${proposal.id}_${Date.now()}`;
    
    // Final Cloudinary URL
    const cloudinaryImageUrl = `${cloudinaryUrl}/${params}/${templateUrl}`;
    
    console.log(`Generating share image: ${cloudinaryImageUrl}`);
    
    // Fetch the image from Cloudinary
    const imageResponse = await fetch(cloudinaryImageUrl);
    
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }
    
    // Get the image as a blob
    const imageBlob = await imageResponse.blob();
    
    // Upload the image to your R2 bucket
    await env.MEMES_BUCKET.put(imageId, imageBlob, {
      httpMetadata: {
        contentType: 'image/png',
      },
    });
    
    // Generate the public URL for the stored image
    const shareImageUrl = `https://radical.omar-c29.workers.dev/memes/${imageId}`;
    
    console.log(`Stored share image at: ${shareImageUrl}`);
    
    // Update the proposal in the database with the share image URL
    await env.DB.prepare(`
      UPDATE proposals
      SET share_image_url = ?
      WHERE id = ?
    `).bind(shareImageUrl, proposal.id).run();
    
    return shareImageUrl;
  } catch (error) {
    console.error('Error generating share image:', error);
    // Return a fallback image URL in case of failure
    return "https://radical.omar-c29.workers.dev/memes/mickeymeta.PNG";
  }
}

// Create a new proposal
async function createProposal(request, env) {
  try {
    const data = await request.json();
    const { text, authorId, trending = false } = data;
    
    console.log(`Creating proposal: ${JSON.stringify(data)}`);
    
    if (!text || !authorId) {
      return createResponse({ error: 'Missing required fields', received: { text, authorId } }, 400);
    }
    
    // Check if user exists first
    try {
      const userCheck = await env.DB.prepare(`SELECT id, name FROM users WHERE id = ?`).bind(authorId).first();
      if (!userCheck) {
        return createResponse({ 
          error: 'Author does not exist', 
          authorId,
          suggestion: 'Create the user first before posting a proposal' 
        }, 400);
      }
      
      // Create a temporary proposal object with author name for image generation
      const tempProposal = {
        id: 'proposal_' + Date.now(),
        text: text,
        author_name: userCheck.name
      };
      
      const id = tempProposal.id;
      const timestamp = Date.now();
      
      // Insert the proposal first
      const query = `
        INSERT INTO proposals (id, author_id, text, timestamp, trending)
        VALUES (?, ?, ?, ?, ?)
      `;
      
      await env.DB.prepare(query).bind(id, authorId, text, timestamp, trending ? 1 : 0).run();
      
      // Generate and store the share image
      const shareImageUrl = await generateAndStoreShareImage(tempProposal, env);
      
      // Update the proposal with the share image URL
      if (shareImageUrl) {
        await env.DB.prepare(`
          UPDATE proposals
          SET share_image_url = ?
          WHERE id = ?
        `).bind(shareImageUrl, id).run();
      }
      
      console.log(`Successfully created proposal with ID: ${id}`);
      
      return createResponse({ 
        id, 
        authorId, 
        text, 
        timestamp, 
        trending,
        shareImageUrl 
      });
    } catch (dbError) {
      return createResponse({ 
        error: 'Failed to create proposal in database', 
        details: logError(dbError, { 
          action: 'insert_proposal', 
          proposal: { id, authorId, timestamp, trending } 
        })
      }, 500);
    }
  } catch (error) {
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


  // to serve audio files from R2

  async function serveMedia(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Determine if this is a meme or audio file request
    let key;
    if (path.startsWith('/memes/')) {
      key = path.replace('/memes/', '');
    } else if (path.startsWith('/audio/')) {
      key = path.replace('/audio/', '');
    } else {
      return new Response('Not found', { status: 404 });
    }
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }
    
    try {
      const object = await env.MEMES_BUCKET.get(key);
      
      if (object === null) {
        return new Response('File not found', { status: 404 });
      }
      
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for a year
      
      // Set the appropriate content-type based on file extension
      if (key.endsWith('.mp3')) {
        headers.set('Content-Type', 'audio/mpeg');
      } else if (key.endsWith('.wav')) {
        headers.set('Content-Type', 'audio/wav');
      } else if (key.endsWith('.ogg')) {
        headers.set('Content-Type', 'audio/ogg');
      }
      
      // Add CORS headers
      Object.keys(corsHeaders).forEach(key => {
        headers.set(key, corsHeaders[key]);
      });
      
      return new Response(object.body, {
        headers
      });
    } catch (error) {
      console.error('Error serving media:', error);
      return new Response('Internal Server Error', { status: 500 });
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
  try {
    const data = await request.json();
    const { proposalId, userId, commentText } = data;
    
    console.log(`Creating comment: ${JSON.stringify(data)}`);
    
    if (!proposalId || !userId || !commentText) {
      return createResponse({
        error: 'Missing required fields',
        received: { proposalId, userId, commentText: commentText ? '[present]' : '[missing]' }
      }, 400);
    }
    
    // Check if proposal exists
    try {
      const proposalCheck = await env.DB.prepare(
        `SELECT id FROM proposals WHERE id = ?`
      ).bind(proposalId).first();
      
      if (!proposalCheck) {
        return createResponse({ error: 'Proposal does not exist', proposalId }, 404);
      }
    } catch (checkError) {
      return createResponse({
        error: 'Error checking proposal existence',
        details: logError(checkError, { action: 'check_proposal', proposalId })
      }, 500);
    }
    
    // Check if user exists
    try {
      const userCheck = await env.DB.prepare(
        `SELECT id FROM users WHERE id = ?`
      ).bind(userId).first();
      
      if (!userCheck) {
        return createResponse({ error: 'User does not exist', userId }, 404);
      }
    } catch (userError) {
      return createResponse({
        error: 'Error checking user existence',
        details: logError(userError, { action: 'check_user', userId })
      }, 500);
    }
    
    const id = 'comment_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const timestamp = Date.now();
    
    try {
      await env.DB.prepare(`
        INSERT INTO comments (id, proposal_id, user_id, comment_text, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `).bind(id, proposalId, userId, commentText, timestamp).run();
      
      console.log(`Successfully created comment with ID: ${id}`);
      
      // Get user name for response
      const userQuery = await env.DB.prepare(
        `SELECT name FROM users WHERE id = ?`
      ).bind(userId).first();
      
      return createResponse({
        id,
        proposalId,
        userId,
        userName: userQuery.name,
        commentText,
        timestamp
      });
    } catch (dbError) {
      return createResponse({
        error: 'Failed to create comment in database',
        details: logError(dbError, {
          action: 'insert_comment',
          comment: { id, proposalId, userId, timestamp }
        })
      }, 500);
    }
  } catch (error) {
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
