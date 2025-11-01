# Social Media Scheduler

A local web application for scheduling posts to X (Twitter) and LinkedIn. Schedule individual posts or post series with images and custom timing.

## Features

- 📅 Schedule posts for specific dates and times
- 📝 Create post series (up to 4 related posts) with custom intervals
- 🖼️ Upload and attach images to posts
- 🐦 Post to X (Twitter) with full API v2 support
- 💼 Post to LinkedIn (personal and company pages)
- 🔄 Automatic retry logic for failed posts
- 📊 View posting history and scheduled posts
- 🔒 Secure local storage of credentials

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/social-media-scheduler.git
   cd social-media-scheduler
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup configuration**
   ```bash
   npm run setup
   ```

4. **Start the application**
   ```bash
   npm start
   ```

5. **Open your browser**
   Navigate to `http://localhost:3000`

## Configuration

### API Keys Setup

You'll need to obtain API keys from:

#### X (Twitter) API
1. Go to [Twitter Developer Portal](https://developer.twitter.com/)
2. Create a new app
3. Generate API Key, API Secret, Access Token, and Access Token Secret
4. Enable OAuth 2.0

#### LinkedIn API
1. Go to [LinkedIn Developer Portal](https://developer.linkedin.com/)
2. Create a new app
3. Add required permissions: `w_member_social`, `r_liteprofile`
4. Get Client ID and Client Secret

### Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# X (Twitter) API
TWITTER_API_KEY=your_api_key_here
TWITTER_API_SECRET=your_api_secret_here
TWITTER_ACCESS_TOKEN=your_access_token_here
TWITTER_ACCESS_TOKEN_SECRET=your_access_token_secret_here

# LinkedIn API
LINKEDIN_CLIENT_ID=your_client_id_here
LINKEDIN_CLIENT_SECRET=your_client_secret_here
LINKEDIN_REDIRECT_URI=http://localhost:3000/auth/linkedin/callback

# Database
DATABASE_PATH=./data/scheduler.db

# File Upload
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=5242880
```

## Usage

### Creating a Single Post

1. Navigate to "New Post"
2. Select platforms (X, LinkedIn, or both)
3. Enter your post content
4. Upload images (optional)
5. Set the scheduled time
6. Click "Schedule Post"

### Creating a Post Series

1. Navigate to "New Series"
2. Select platforms
3. Create 2-4 related posts
4. Set the interval between posts (minutes, hours, days)
5. Set the start time for the series
6. Click "Schedule Series"

### Managing Scheduled Posts

- View all scheduled posts in the Dashboard
- Edit or delete posts before they're sent
- View posting history and success/failure status
- Retry failed posts manually

## Development

### Running in Development Mode

```bash
npm run dev
```

This starts the server with nodemon for automatic restarts.

### Project Structure

```
social-media-scheduler/
├── src/
│   ├── app.js              # Main Express application
│   ├── scheduler.js        # Background scheduling engine
│   ├── routes/             # API routes
│   ├── services/           # Social media API integrations
│   ├── models/             # Database models
│   └── middleware/         # Express middleware
├── public/                 # Static web assets
├── views/                  # HTML templates
├── uploads/                # User uploaded images
├── data/                   # SQLite database
├── scripts/                # Setup and utility scripts
└── docs/                   # Documentation
```

### Database Schema

The app uses SQLite with the following tables:
- `posts` - Individual scheduled posts
- `series` - Post series configurations
- `media` - Uploaded images and attachments
- `accounts` - Connected social media accounts
- `history` - Posting history and logs

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues:

1. Check the [Issues](https://github.com/yourusername/social-media-scheduler/issues) page
2. Review the setup documentation
3. Create a new issue with detailed information

## Roadmap

- [ ] Instagram integration
- [ ] Thread/series preview
- [ ] Bulk CSV import
- [ ] Analytics dashboard
- [ ] Mobile app
- [ ] Docker deployment