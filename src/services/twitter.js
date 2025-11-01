const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const crypto = require('crypto');

class TwitterService {
  constructor() {
    this.apiKey = process.env.TWITTER_API_KEY;
    this.apiSecret = process.env.TWITTER_API_SECRET;
    this.accessToken = process.env.TWITTER_ACCESS_TOKEN;
    this.accessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;
    
    if (!this.apiKey || !this.apiSecret || !this.accessToken || !this.accessTokenSecret) {
      console.warn('Twitter API credentials not configured. Twitter posting will be disabled.');
    }
  }

  // Generate OAuth 1.0a signature for Twitter API v1.1 (for media upload)
  generateOAuthSignature(method, url, params) {
    const oauthParams = {
      oauth_consumer_key: this.apiKey,
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: this.accessToken,
      oauth_version: '1.0'
    };

    // Combine OAuth params with request params
    const allParams = { ...oauthParams, ...params };
    
    // Create parameter string
    const paramString = Object.keys(allParams)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
      .join('&');

    // Create signature base string
    const signatureBaseString = [
      method.toUpperCase(),
      encodeURIComponent(url),
      encodeURIComponent(paramString)
    ].join('&');

    // Create signing key
    const signingKey = `${encodeURIComponent(this.apiSecret)}&${encodeURIComponent(this.accessTokenSecret)}`;

    // Generate signature
    const signature = crypto
      .createHmac('sha1', signingKey)
      .update(signatureBaseString)
      .digest('base64');

    oauthParams.oauth_signature = signature;

    return oauthParams;
  }

  // Create OAuth header
  createAuthHeader(oauthParams) {
    const headerValue = Object.keys(oauthParams)
      .sort()
      .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
      .join(', ');
    
    return `OAuth ${headerValue}`;
  }

  // Upload media to Twitter (using API v1.1)
  async uploadMedia(mediaPath) {
    if (!fs.existsSync(mediaPath)) {
      throw new Error(`Media file not found: ${mediaPath}`);
    }

    const url = 'https://upload.twitter.com/1.1/media/upload.json';
    const mediaData = fs.readFileSync(mediaPath);
    
    // For large files, we might need chunked upload, but for simplicity we'll use simple upload
    const formData = new FormData();
    formData.append('media', mediaData, {
      filename: mediaPath.split('/').pop(),
      contentType: this.getMediaType(mediaPath)
    });

    const oauthParams = this.generateOAuthSignature('POST', url, {});
    const authHeader = this.createAuthHeader(oauthParams);

    try {
      const response = await axios.post(url, formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': authHeader
        }
      });

      return response.data.media_id_string;
    } catch (error) {
      console.error('Twitter media upload error:', error.response?.data || error.message);
      throw new Error(`Failed to upload media to Twitter: ${error.response?.data?.errors?.[0]?.message || error.message}`);
    }
  }

  // Get media MIME type
  getMediaType(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    const mimeTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      mp4: 'video/mp4',
      mov: 'video/quicktime'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  // Post tweet using Twitter API v2
  async postTweet(content, mediaPath = null) {
    if (!this.apiKey) {
      throw new Error('Twitter API credentials not configured');
    }

    try {
      let mediaId = null;
      
      // Upload media if provided
      if (mediaPath) {
        mediaId = await this.uploadMedia(mediaPath);
      }

      // Prepare tweet data
      const tweetData = {
        text: content
      };

      if (mediaId) {
        tweetData.media = {
          media_ids: [mediaId]
        };
      }

      // Use API v2 for posting tweet
      const url = 'https://api.twitter.com/2/tweets';
      
      // For API v2, we need to use OAuth 2.0 Bearer token or OAuth 1.0a
      // Since we have OAuth 1.0a credentials, we'll use those
      const oauthParams = this.generateOAuthSignature('POST', url, {});
      const authHeader = this.createAuthHeader(oauthParams);

      const response = await axios.post(url, tweetData, {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });

      console.log('Tweet posted successfully:', response.data);
      return {
        success: true,
        tweetId: response.data.data.id,
        response: response.data
      };

    } catch (error) {
      console.error('Twitter posting error:', error.response?.data || error.message);
      
      // Handle specific Twitter API errors
      if (error.response?.status === 401) {
        throw new Error('Twitter authentication failed. Please check your API credentials.');
      } else if (error.response?.status === 403) {
        throw new Error('Twitter posting forbidden. Check your app permissions and account status.');
      } else if (error.response?.status === 429) {
        throw new Error('Twitter rate limit exceeded. Please try again later.');
      }
      
      throw new Error(`Failed to post to Twitter: ${error.response?.data?.errors?.[0]?.message || error.message}`);
    }
  }

  // Validate Twitter credentials
  async validateCredentials() {
    try {
      const url = 'https://api.twitter.com/1.1/account/verify_credentials.json';
      const oauthParams = this.generateOAuthSignature('GET', url, {});
      const authHeader = this.createAuthHeader(oauthParams);

      const response = await axios.get(url, {
        headers: {
          'Authorization': authHeader
        }
      });

      return {
        valid: true,
        username: response.data.screen_name,
        name: response.data.name
      };
    } catch (error) {
      return {
        valid: false,
        error: error.response?.data || error.message
      };
    }
  }

  // Get account information
  async getAccountInfo() {
    const validation = await this.validateCredentials();
    if (!validation.valid) {
      throw new Error('Invalid Twitter credentials');
    }
    return validation;
  }
}

module.exports = TwitterService;