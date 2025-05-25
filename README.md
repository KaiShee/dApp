# Real Estate dApp Installation Guide

## Prerequisites
Before you begin, make sure you have the following installed:
- [Node.js](https://nodejs.org/) (version 14 or higher)
- [Ganache](https://trufflesuite.com/ganache/) (for local blockchain development)
- [MetaMask](https://metamask.io/) (browser extension for Ethereum wallet)

## Installation Steps

### 1. Clone the Repository
```bash
git clone [your-repository-url]
cd [your-repository-name]
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Set Up Ganache
1. Open Ganache
2. Click on "New Workspace" or "Quickstart"
3. Keep the default settings (port 7545)
4. Save the workspace

### 4. Configure MetaMask
1. Open MetaMask in your browser
2. Click on the network dropdown and select "Custom RPC"
3. Add the following network details:
   - Network Name: Ganache
   - RPC URL: http://127.0.0.1:7545
   - Chain ID: 1337
   - Currency Symbol: ETH
4. Click "Save"

### 5. Import Ganache Account to MetaMask
1. In Ganache, click on the key icon next to any account
2. Copy the private key
3. In MetaMask, click on the account icon
4. Select "Import Account"
5. Paste the private key and click "Import"

### 6. Deploy Smart Contracts
```bash
truffle migrate --reset
```

### 7. Start the Application
```bash
npm start
```

## Using the Application

1. Open your browser and navigate to `http://localhost:3000`
2. Connect your MetaMask wallet to the application
3. Make sure you're connected to the Ganache network in MetaMask
4. You should now be able to:
   - Browse properties
   - Purchase property shares
   - View your portfolio
   - Manage rentals
   - View transaction history

## Troubleshooting

### Common Issues

1. **MetaMask Connection Issues**
   - Make sure MetaMask is unlocked
   - Verify you're connected to the Ganache network
   - Check if you have enough ETH in your account

2. **Transaction Failures**
   - Ensure you have sufficient ETH in your account
   - Check if you're connected to the correct network
   - Verify the contract is properly deployed

3. **Ganache Connection Issues**
   - Make sure Ganache is running
   - Verify the RPC URL in MetaMask matches Ganache's URL
   - Check if the port number is correct (default: 7545)

### Getting Help

If you encounter any issues:
1. Check the browser console for error messages
2. Verify all prerequisites are properly installed
3. Ensure all steps in the installation guide are followed correctly

## Additional Notes

- The application uses the Ganache local blockchain for development
- All transactions require ETH, which you can get from Ganache
- Make sure to keep your private keys secure
- The application is designed for educational purposes

## Support

For any questions or issues, please contact:
- Your Name
- Your Email
- Your Contact Information 