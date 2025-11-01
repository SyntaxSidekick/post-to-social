const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
require('dotenv').config();

// Import social media services (will create these next)
const TwitterService = require('./services/twitter');
const LinkedInService = require('./services/linkedin');

class Scheduler {
  constructor() {
    this.db = new sqlite3.Database(process.env.DATABASE_PATH || './data/scheduler.db');
    this.twitterService = new TwitterService();
    this.linkedinService = new LinkedInService();
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      console.log('Scheduler is already running');
      return;
    }

    console.log('🕐 Starting Social Media Scheduler...');
    
    // Run every minute
    cron.schedule('* * * * *', () => {
      this.checkAndPostScheduledPosts();
    });

    this.isRunning = true;
    console.log('✅ Scheduler started - checking for posts every minute');
  }

  async checkAndPostScheduledPosts() {
    const now = new Date().toISOString();
    
    try {
      // Get all posts scheduled for now or earlier that haven't been posted
      const posts = await this.getScheduledPosts(now);
      
      for (const post of posts) {
        await this.processPost(post);
      }
    } catch (error) {
      console.error('Error in scheduler:', error);
      this.logError('SCHEDULER_ERROR', error.message);
    }
  }

  getScheduledPosts(currentTime) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM posts 
        WHERE status = 'scheduled' 
        AND scheduled_time <= ? 
        ORDER BY scheduled_time ASC
      `, [currentTime], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async processPost(post) {
    console.log(`📝 Processing post ${post.id}: "${post.content.substring(0, 50)}..."`);
    
    // Update status to 'posting'
    await this.updatePostStatus(post.id, 'posting');
    
    const platforms = post.platforms.split(',');
    let successCount = 0;
    let errors = [];

    for (const platform of platforms) {
      try {
        await this.postToPlatform(post, platform.trim());
        await this.logPostingHistory(post.id, platform, 'posted', null, null);
        successCount++;
        console.log(`✅ Posted to ${platform} successfully`);
      } catch (error) {
        console.error(`❌ Failed to post to ${platform}:`, error.message);
        errors.push(`${platform}: ${error.message}`);
        await this.logPostingHistory(post.id, platform, 'failed', null, error.message);
      }
    }

    // Update final status
    if (successCount === platforms.length) {
      await this.updatePostStatus(post.id, 'posted', new Date().toISOString());
    } else if (successCount > 0) {
      await this.updatePostStatus(post.id, 'partial', null, errors.join('; '));
    } else {
      // All platforms failed - schedule retry if under retry limit
      if (post.retry_count < (process.env.RETRY_ATTEMPTS || 3)) {
        await this.scheduleRetry(post);
      } else {
        await this.updatePostStatus(post.id, 'failed', null, errors.join('; '));
      }
    }
  }

  async postToPlatform(post, platform) {
    const content = post.content;
    const mediaPath = post.media_path ? `./uploads/${post.media_path}` : null;

    switch (platform) {
      case 'twitter':
        return await this.twitterService.postTweet(content, mediaPath);
      case 'linkedin':
        return await this.linkedinService.postUpdate(content, mediaPath);
      default:
        throw new Error(`Unknown platform: ${platform}`);
    }
  }

  updatePostStatus(postId, status, postedAt = null, errorMessage = null) {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE posts 
        SET status = ?, posted_at = ?, error_message = ?
        WHERE id = ?
      `;
      
      this.db.run(sql, [status, postedAt, errorMessage, postId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }

  async scheduleRetry(post) {
    const retryDelay = parseInt(process.env.RETRY_DELAY || 300000); // 5 minutes default
    const newScheduledTime = new Date(Date.now() + retryDelay).toISOString();
    
    return new Promise((resolve, reject) => {
      this.db.run(`
        UPDATE posts 
        SET status = 'scheduled', 
            scheduled_time = ?, 
            retry_count = retry_count + 1,
            error_message = ?
        WHERE id = ?
      `, [newScheduledTime, `Retry ${post.retry_count + 1}`, post.id], function(err) {
        if (err) reject(err);
        else {
          console.log(`🔄 Scheduled retry for post ${post.id} at ${newScheduledTime}`);
          resolve(this.changes);
        }
      });
    });
  }

  logPostingHistory(postId, platform, status, responseData, errorMessage) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT INTO posting_history (post_id, platform, status, response_data, error_message)
        VALUES (?, ?, ?, ?, ?)
      `, [postId, platform, status, responseData, errorMessage], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  logError(type, message) {
    const logEntry = `[${new Date().toISOString()}] ${type}: ${message}\n`;
    fs.appendFileSync('./logs/scheduler.log', logEntry);
  }

  stop() {
    if (this.db) {
      this.db.close();
    }
    this.isRunning = false;
    console.log('🛑 Scheduler stopped');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Shutting down gracefully...');
  if (global.scheduler) {
    global.scheduler.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM. Shutting down gracefully...');
  if (global.scheduler) {
    global.scheduler.stop();
  }
  process.exit(0);
});

// If this file is run directly, start the scheduler
if (require.main === module) {
  const scheduler = new Scheduler();
  global.scheduler = scheduler;
  scheduler.start();
  
  // Keep the process alive
  process.stdin.resume();
}

module.exports = Scheduler;