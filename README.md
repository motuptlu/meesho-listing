# Meesho Auto Lister

A complete Chrome Extension and Node.js backend solution for automated Meesho product listing using Google Gemini 1.5 Flash AI.

## Features
- **AI Analysis**: Automatically extracts product details from images using Gemini 1.5 Flash.
- **Auto-Fill**: One-click form filling for the Meesho Supplier Panel.
- **Modern UI**: Clean, purple-themed extension popup with drag-and-drop support.
- **Full Control**: Editable AI results before filling the form.

## Prerequisites
- **Node.js**: Version 18.0 or higher.
- **Chrome Browser**: For running the extension.
- **Gemini API Key**: A free key from Google AI Studio.

## Getting Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Log in with your Google account.
3. Click on **"Get API key"** in the sidebar.
4. Click **"Create API key in new project"**.
5. Copy your new API key.

## Backend Setup
1. Open your terminal/command prompt.
2. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```
5. Open `.env` and paste your Gemini API key:
   ```env
   GEMINI_API_KEY=your_copied_key_here
   ```
6. Start the server:
   ```bash
   npm start
   ```
   The backend will run on `http://localhost:3000`.

## Chrome Extension Setup
1. Open Chrome and go to `chrome://extensions/`.
2. Enable **"Developer mode"** (toggle in the top right).
3. Click **"Load unpacked"**.
4. Select the `extension` folder from this project.
5. The "Meesho Auto Lister" icon should now appear in your extension bar.

## How to Use
1. Log in to your [Meesho Supplier Panel](https://supplier.meesho.com).
2. Go to the "Add Single Catalog" section.
3. Click the extension icon in your browser.
4. Upload up to 5 product images (drag and drop or click).
5. Click **"Analyze with AI"**.
6. Review the extracted details in the results section.
7. Click **"Fill Meesho Form"** to automatically populate the listing page.

## Troubleshooting
- **Backend not running**: Ensure the backend server is active on terminal and showing "Server is running on port 3000".
- **API Key Error**: Verify your Gemini API key is correct and has not expired.
- **Form not filling**: Ensure you are on the correct Meesho listing page. Try refreshing the page if the extension doesn't connect.
- **Extension not loading**: Check if you have any syntax errors in the console of the extension popup (Right click popup -> Inspect).

## Tech Stack
- **Extension**: Manifest V3, JavaScript, CSS3, HTML5.
- **Backend**: Node.js, Express.js, Multer, Morgan, CORS.
- **AI Engine**: Google Gemini 1.5 Flash.
