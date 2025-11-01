const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

class LinkedInService {
  constructor() {
    this.clientId = process.env.LINKEDIN_CLIENT_ID;
    this.clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    this.redirectUri = process.env.LINKEDIN_REDIRECT_URI;
    this.accessToken = null; // Will be set after OAuth flow
    
    if (!this.clientId || !this.clientSecret) {
      console.warn('LinkedIn API credentials not configured. LinkedIn posting will be disabled.');
    }
  }

  // Generate LinkedIn OAuth authorization URL
  getAuthorizationUrl() {
    const scope = 'w_member_social,r_liteprofile,r_emailaddress';
    const state = Math.random().toString(36).substring(7);
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state: state,
      scope: scope
    });

    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  // Exchange authorization code for access token
  async getAccessToken(authorizationCode) {
    try {
      const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', {
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: this.redirectUri,
        client_id: this.clientId,
        client_secret: this.clientSecret
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      this.accessToken = response.data.access_token;
      return {
        access_token: response.data.access_token,
        expires_in: response.data.expires_in,
        refresh_token: response.data.refresh_token
      };
    } catch (error) {
      console.error('LinkedIn token exchange error:', error.response?.data || error.message);
      throw new Error(`Failed to get LinkedIn access token: ${error.response?.data?.error_description || error.message}`);
    }
  }

  // Set access token (when loaded from database)
  setAccessToken(token) {
    this.accessToken = token;
  }

  // Get current user's profile
  async getProfile() {
    if (!this.accessToken) {
      throw new Error('LinkedIn access token not available. Please authenticate first.');
    }

    try {
      const response = await axios.get('https://api.linkedin.com/v2/people/~', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      return {
        id: response.data.id,
        firstName: response.data.firstName?.localized?.en_US,
        lastName: response.data.lastName?.localized?.en_US,
        profilePicture: response.data.profilePicture?.['displayImage~']?.elements?.[0]?.identifiers?.[0]?.identifier
      };
    } catch (error) {
      console.error('LinkedIn profile error:', error.response?.data || error.message);
      throw new Error(`Failed to get LinkedIn profile: ${error.response?.data?.message || error.message}`);
    }
  }

  // Upload image to LinkedIn
  async uploadImage(imagePath) {
    if (!this.accessToken) {
      throw new Error('LinkedIn access token not available');
    }

    try {
      // Step 1: Register upload
      const profile = await this.getProfile();
      const uploadResponse = await axios.post('https://api.linkedin.com/v2/assets?action=registerUpload', {
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: `urn:li:person:${profile.id}`,
          serviceRelationships: [{
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent'
          }]
        }
      }, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const uploadUrl = uploadResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
      const asset = uploadResponse.data.value.asset;

      // Step 2: Upload the image
      const imageData = fs.readFileSync(imagePath);
      await axios.put(uploadUrl, imageData, {
        headers: {
          'Content-Type': 'application/octet-stream'
        }
      });

      return asset;
    } catch (error) {
      console.error('LinkedIn image upload error:', error.response?.data || error.message);
      throw new Error(`Failed to upload image to LinkedIn: ${error.response?.data?.message || error.message}`);
    }
  }

  // Post update to LinkedIn
  async postUpdate(content, mediaPath = null) {
    if (!this.accessToken) {
      throw new Error('LinkedIn access token not available. Please authenticate first.');
    }

    try {
      const profile = await this.getProfile();
      
      // Prepare post data
      const postData = {
        author: `urn:li:person:${profile.id}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: content
            },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      };

      // Add media if provided
      if (mediaPath && fs.existsSync(mediaPath)) {
        const mediaAsset = await this.uploadImage(mediaPath);
        postData.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory = 'IMAGE';
        postData.specificContent['com.linkedin.ugc.ShareContent'].media = [{
          status: 'READY',
          description: {
            text: 'Shared image'
          },
          media: mediaAsset,
          title: {
            text: 'Image'
          }
        }];
      }

      // Post the update
      const response = await axios.post('https://api.linkedin.com/v2/ugcPosts', postData, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });

      console.log('LinkedIn post created successfully:', response.data);
      return {
        success: true,
        postId: response.data.id,
        response: response.data
      };

    } catch (error) {
      console.error('LinkedIn posting error:', error.response?.data || error.message);
      
      // Handle specific LinkedIn API errors
      if (error.response?.status === 401) {
        throw new Error('LinkedIn authentication failed. Please re-authenticate.');
      } else if (error.response?.status === 403) {
        throw new Error('LinkedIn posting forbidden. Check your app permissions.');
      } else if (error.response?.status === 429) {
        throw new Error('LinkedIn rate limit exceeded. Please try again later.');
      }
      
      throw new Error(`Failed to post to LinkedIn: ${error.response?.data?.message || error.message}`);
    }
  }

  // Validate LinkedIn credentials
  async validateCredentials() {
    try {
      const profile = await this.getProfile();
      return {
        valid: true,
        profile: profile
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  // Post to LinkedIn company page (requires additional permissions)
  async postToCompanyPage(companyId, content, mediaPath = null) {
    if (!this.accessToken) {
      throw new Error('LinkedIn access token not available');
    }

    try {
      const postData = {
        author: `urn:li:organization:${companyId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: content
            },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      };

      // Add media if provided (similar to personal post)
      if (mediaPath && fs.existsSync(mediaPath)) {
        const mediaAsset = await this.uploadImage(mediaPath);
        postData.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory = 'IMAGE';
        postData.specificContent['com.linkedin.ugc.ShareContent'].media = [{
          status: 'READY',
          description: {
            text: 'Shared image'
          },
          media: mediaAsset,
          title: {
            text: 'Image'
          }
        }];
      }

      const response = await axios.post('https://api.linkedin.com/v2/ugcPosts', postData, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });

      return {
        success: true,
        postId: response.data.id,
        response: response.data
      };

    } catch (error) {
      console.error('LinkedIn company posting error:', error.response?.data || error.message);
      throw new Error(`Failed to post to LinkedIn company page: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get user's company pages (requires additional permissions)
  async getCompanyPages() {
    if (!this.accessToken) {
      throw new Error('LinkedIn access token not available');
    }

    try {
      const response = await axios.get('https://api.linkedin.com/v2/organizationAcls?q=roleAssignee', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      return response.data.elements.map(element => ({
        id: element.organization.replace('urn:li:organization:', ''),
        role: element.role
      }));
    } catch (error) {
      console.error('LinkedIn company pages error:', error.response?.data || error.message);
      throw new Error(`Failed to get LinkedIn company pages: ${error.response?.data?.message || error.message}`);
    }
  }
}

module.exports = LinkedInService;