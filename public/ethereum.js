let web3;
let userAccount;
let propertyContract;
let selectedPropertyId;
let reviewsModal;
let transactionHistoryModal;
let rentalModal;
let rentalContract;
let selectedPropertyForRental;


const DEFAULT_PROPERTY_IMAGE = 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1073&q=80';

const purchaseModal = new bootstrap.Modal(document.getElementById('purchaseModal'));

async function init() {
    try {
        if (window.ethereum) {
            web3 = new Web3(window.ethereum);
            
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            userAccount = accounts[0];
            console.log('Connected account:', userAccount);
            
            const response = await fetch('/RealEstate.json');
            const contractJson = await response.json();
            
            const networkId = await web3.eth.net.getId();
            console.log('Network ID:', networkId);
            
            if (!contractJson.networks[networkId]) {
                throw new Error(`Contract not deployed on network ${networkId}. Please switch to the correct network.`);
            }
            
            propertyContract = new web3.eth.Contract(
                contractJson.abi,
                contractJson.networks[networkId].address
            );

            if (!propertyContract.methods) {
                throw new Error('Contract initialization failed. Please refresh the page.');
            }

            console.log('Contract initialized successfully');

            // Add rental functionality if not present in contract
            if (!propertyContract.methods.rentProperty) {
                console.log('Adding rental functionality to contract');
                propertyContract.methods.rentProperty = function(propertyId, duration) {
                    const encodedCall = web3.eth.abi.encodeFunctionCall({
                        name: 'rentProperty',
                        type: 'function',
                        inputs: [
                            {
                                type: 'uint256',
                                name: 'propertyId'
                            },
                            {
                                type: 'uint256',
                                name: 'duration'
                            }
                        ]
                    }, [propertyId.toString(), duration.toString()]);

                    return {
                        send: async function(options) {
                            try {
                                // Get property details
                                const property = await propertyContract.methods.getProperty(propertyId).call();
                                
                                // Get shareholders
                                const shareholders = await propertyContract.methods.getPropertyShareholders(propertyId).call();
                                const shares = await Promise.all(
                                    shareholders[0].map(async (addr) => {
                                        return await propertyContract.methods.getPropertyShares(propertyId, addr).call();
                                    })
                                );
                                
                                // Calculate total shares
                                const totalShares = shares.reduce((a, b) => parseInt(a) + parseInt(b), 0);
                                
                                // Send rent to each shareholder
                                const transactions = [];
                                for (let i = 0; i < shareholders[0].length; i++) {
                                    const shareholder = shareholders[0][i];
                                    const shareCount = parseInt(shares[i]);
                                    if (shareCount > 0) {
                                        const rentShare = (BigInt(options.value) * BigInt(shareCount)) / BigInt(totalShares);
                                        const tx = await web3.eth.sendTransaction({
                                            from: options.from,
                                            to: shareholder,
                                            value: rentShare.toString(),
                                            gas: options.gas || '3000000'
                                        });
                                        transactions.push(tx);
                                    }
                                }

                                // Store rental information
                                const rentalInfo = {
                                    propertyId: propertyId,
                                    tenant: options.from,
                                    startDate: Math.floor(Date.now() / 1000),
                                    endDate: Math.floor(Date.now() / 1000) + (duration * 365 * 24 * 60 * 60),
                                    yearlyRent: (BigInt(options.value) / BigInt(duration)).toString(),
                                    isActive: true
                                };

                                localStorage.setItem(`rental_${propertyId}`, JSON.stringify(rentalInfo));

                                // Return transaction result
                                return {
                                    events: {
                                        PropertyRented: {
                                            returnValues: {
                                                propertyId: propertyId,
                                                tenant: options.from,
                                                duration: duration,
                                                totalRent: options.value
                                            }
                                        }
                                    },
                                    transactionHash: transactions[0].transactionHash
                                };
                            } catch (error) {
                                console.error('Rental transaction error:', error);
                                throw error;
                            }
                        }
                    };
                };

                propertyContract.methods.getRentalDetails = function(propertyId) {
                    return {
                        call: async function() {
                            const rentalData = localStorage.getItem(`rental_${propertyId}`);
                            if (rentalData) {
                                return JSON.parse(rentalData);
                            }
                            return {
                                tenant: '0x0000000000000000000000000000000000000000',
                                startDate: '0',
                                endDate: '0',
                                yearlyRent: '0',
                                isActive: false
                            };
                        }
                    };
                };
            }

            document.getElementById('networkStatus').innerHTML = `<i class="bi bi-circle-fill text-success"></i> Connected to network ${networkId}`;
            
            // Initialize modals
            reviewsModal = new bootstrap.Modal(document.getElementById('reviewsModal'));
            if (!document.getElementById('reviewsModal')) {
                // Create reviews modal if it doesn't exist
                const reviewsModalHtml = `
                    <div class="modal fade" id="reviewsModal" tabindex="-1">
                        <div class="modal-dialog modal-lg">
                            <div class="modal-content">
                                <div class="modal-header">
                                    <h5 class="modal-title">Property Reviews</h5>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                                </div>
                                <div class="modal-body">
                                    <div id="propertyReviewsDetails"></div>
                                    <div class="property-rating mb-3"></div>
                                    <div id="reviewsList"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                document.body.insertAdjacentHTML('beforeend', reviewsModalHtml);
                reviewsModal = new bootstrap.Modal(document.getElementById('reviewsModal'));
            }

            // Check registration status
            const isRegistered = await propertyContract.methods.isUserRegistered(userAccount).call();
            console.log('User registration status:', isRegistered);

            if (isRegistered) {
                document.getElementById('registrationSection').style.display = 'none';
                document.getElementById('mainContent').style.display = 'block';
                console.log('Adding rentals tab...');
                addRentalsTab();
                console.log('Loading initial data...');
                await loadProperties();
                await loadPortfolio();
                await loadUserRentals();
                console.log('Initial data loaded successfully');
            } else {
                document.getElementById('registrationSection').style.display = 'block';
                document.getElementById('mainContent').style.display = 'none';
            }

            setupEventListeners();
            startAutoRefresh();

        } else {
            throw new Error('Please install MetaMask');
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Initialization error: ' + error.message);
    }
}

function setupEventListeners() {
    document.getElementById('connectWallet').addEventListener('click', () => init());

    document.getElementById('registerButton').addEventListener('click', async () => {
        if (!propertyContract || !propertyContract.methods) {
            showError('Contract not initialized. Please refresh the page.');
            return;
        }

        try {
            showLoading('Registering...');
            await propertyContract.methods.registerUser().send({ from: userAccount });
            document.getElementById('registrationSection').style.display = 'none';
            document.getElementById('mainContent').style.display = 'block';
            await loadProperties();
            await loadPortfolio();
            await loadUserRentals();
            showSuccess('Successfully registered!');
        } catch (error) {
            console.error('Registration error:', error);
            showError('Registration failed: ' + error.message);
        }
    });

    document.getElementById('listPropertyForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('propertyName').value;
        const location = document.getElementById('propertyLocation').value;
        const value = web3.utils.toWei(document.getElementById('propertyValue').value, 'ether');
        const totalShares = document.getElementById('totalShares').value;
        const pricePerShare = web3.utils.toWei(document.getElementById('pricePerShare').value, 'ether');

        try {
            // Calculate cost for 50% shares
            const ownerShares = Math.floor(parseInt(totalShares) / 2);
            const ownerSharesCost = BigInt(pricePerShare) * BigInt(ownerShares);
            
            // Check owner's balance
            const balance = await web3.eth.getBalance(userAccount);
            const canAffordShares = BigInt(balance) >= ownerSharesCost;

            // Ask owner's preference
            let buyOwnerShares = false;
            if (canAffordShares) {
                buyOwnerShares = confirm(
                    `Would you like to purchase 50% of shares (${ownerShares} shares) for ${web3.utils.fromWei(ownerSharesCost.toString(), 'ether')} ETH?`
                );
            }

            if (!buyOwnerShares) {
                const listAllShares = confirm(
                    'Would you like to list all shares to the public market instead?'
                );
                if (!listAllShares) {
                    showError('Property listing cancelled');
                    return;
                }
            }

            showLoading('Listing property...');

            // First list the property
            const listingTx = await propertyContract.methods.listProperty(
                name, 
                location, 
                value, 
                totalShares, 
                pricePerShare
            ).send({ from: userAccount });
            
            console.log('Property listing transaction:', listingTx);

            // If owner wants to buy 50% shares
            if (buyOwnerShares) {
                const propertyId = await propertyContract.methods.propertyCount().call();
                showLoading('Purchasing owner shares...');
                
                const purchaseTx = await propertyContract.methods.purchaseShares(propertyId, ownerShares)
                    .send({ 
                        from: userAccount,
                        value: ownerSharesCost.toString()
                    });
                
                console.log('Owner shares purchase transaction:', purchaseTx);
                showSuccess('Property listed and 50% shares purchased successfully!');
            } else {
                showSuccess('Property listed successfully to public market!');
            }

            loadProperties();
            document.getElementById('browse-tab').click();
            e.target.reset();
        } catch (error) {
            console.error('Listing error:', error);
            showError('Listing failed: ' + error.message);
        }
    });

    document.getElementById('shareAmount').addEventListener('input', async (e) => {
        if (selectedPropertyId) {
            const shares = e.target.value;
            if (shares <= 0) {
                document.getElementById('totalCost').textContent = '0 ETH';
                return;
            }

            try {
                const property = await propertyContract.methods.getProperty(selectedPropertyId).call();
                if (shares > parseInt(property.availableShares)) {
                    showError('Cannot purchase more shares than available');
                    e.target.value = property.availableShares;
                    return;
                }

                const pricePerShare = BigInt(property.pricePerShare);
                const totalCost = web3.utils.fromWei(
                    (pricePerShare * BigInt(shares)).toString(),
                    'ether'
                );
                document.getElementById('totalCost').textContent = `${totalCost} ETH`;
            } catch (error) {
                console.error('Error calculating cost:', error);
                showError('Error calculating total cost');
            }
        }
    });

    document.getElementById('confirmPurchase').addEventListener('click', async () => {
        const shares = document.getElementById('shareAmount').value;
        if (!shares || shares <= 0) {
            showError('Please enter a valid number of shares');
            return;
        }

        try {
            const property = await propertyContract.methods.getProperty(selectedPropertyId).call();
            
            if (shares > parseInt(property.availableShares)) {
                showError('Not enough shares available');
                return;
            }

            const totalCost = BigInt(property.pricePerShare) * BigInt(shares);
            
            const balance = await web3.eth.getBalance(userAccount);
            if (BigInt(balance) < totalCost) {
                showError('Insufficient funds to complete the purchase');
                return;
            }

            showLoading('Processing purchase...');
            const tx = await propertyContract.methods.purchaseShares(selectedPropertyId, shares)
                .send({ 
                    from: userAccount, 
                    value: totalCost.toString(),
                    gas: 3000000
                });
            
            console.log('Purchase transaction:', tx);
            
            // Hide the modal
            const purchaseModalEl = document.getElementById('purchaseModal');
            const purchaseModal = bootstrap.Modal.getInstance(purchaseModalEl);
            if (purchaseModal) {
                purchaseModal.hide();
            }
            
            showSuccess('Shares purchased successfully!');
            await loadProperties();
            await loadPortfolio();
            
        } catch (error) {
            console.error('Purchase error:', error);
            showError('Purchase failed: ' + error.message);
        } finally {
            hideLoading();
        }
    });

    if (propertyContract && propertyContract.events) {
        propertyContract.events.ShareholderDividendSent({
            fromBlock: 'latest'
        })
        .on('data', async function(event) {
            console.log('Dividend event received:', event);
            await loadPortfolio();
            await updateDashboardStats();
            showSuccess('Dividend received!');
        })
        .on('error', console.error);

        // Only set up PropertyRented event if it exists in the contract
        try {
            if (propertyContract.methods.isPropertyRented) {
                console.log('Setting up rental event listener...');
                propertyContract.events.PropertyRented({
                    fromBlock: 'latest'
                })
                .on('data', async function(event) {
                    console.log('Rental event received:', event);
                    await loadProperties();
                    await loadUserRentals();
                    showSuccess('Property rental confirmed!');
                })
                .on('error', function(error) {
                    console.error('Rental event error:', error);
                });
            }
        } catch (error) {
            console.error('Error setting up rental events:', error);
        }
    }
}

async function loadProperties() {
    const propertyList = document.getElementById('propertyList');
    propertyList.innerHTML = '<div class="col-12 text-center"><div class="spinner-border text-primary" role="status"></div></div>';

    try {
        const count = await propertyContract.methods.propertyCount().call();
        propertyList.innerHTML = '';
        
        for (let i = 1; i <= count; i++) {
            const property = await propertyContract.methods.getProperty(i).call();
            if (property.isListed) {
                const card = createPropertyCard(i, property);
                propertyList.appendChild(card);
            }
        }

        if (propertyList.children.length === 0) {
            propertyList.innerHTML = `
                <div class="col-12 text-center">
                    <div class="alert alert-info">
                        <i class="bi bi-info-circle"></i> No properties listed yet
                    </div>
                </div>
            `;
        }

        setupPropertyFilters();
    } catch (error) {
        console.error('Error loading properties:', error);
        propertyList.innerHTML = `
            <div class="col-12">
                <div class="alert alert-danger">
                    <i class="bi bi-exclamation-triangle"></i> Error loading properties
                </div>
            </div>
        `;
    }
}

function createPropertyCard(id, property) {
    const div = document.createElement('div');
    div.className = 'col-md-4 mb-4';
    div.dataset.propertyId = id;
    
    const progress = (property.totalShares - property.availableShares) / property.totalShares * 100;
    
    div.innerHTML = `
        <div class="property-card">
            <img src="${DEFAULT_PROPERTY_IMAGE}" class="property-image" alt="${property.name}">
            <h5>${property.name}</h5>
            <p><i class="bi bi-geo-alt"></i> ${property.location}</p>
            <div class="property-stats">
                <div class="row">
                    <div class="col-6">
                        <div class="stat-item">
                            <div class="stat-label">Total Value</div>
                            <div class="stat-value">${web3.utils.fromWei(property.totalValue, 'ether')} ETH</div>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="stat-item">
                            <div class="stat-label">Price per Share</div>
                            <div class="stat-value">${web3.utils.fromWei(property.pricePerShare, 'ether')} ETH</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="mb-3">
                <label class="form-label">Investment Progress</label>
                <div class="progress">
                    <div class="progress-bar" role="progressbar" style="width: ${progress}%" 
                         aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"></div>
                </div>
                <small class="text-muted">
                    ${property.availableShares}/${property.totalShares} shares available
                </small>
            </div>
            <div class="d-grid gap-2">
                ${parseInt(property.availableShares) > 0 ? 
                    `<button class="btn btn-primary w-100 mb-2 buy-shares" data-property-id="${id}">
                        <i class="bi bi-cart-plus"></i> Buy Shares (${property.availableShares} available)
                    </button>` : 
                    `<span class="badge bg-secondary w-100 p-2 mb-2">Sold Out</span>`
                }
                <button class="btn btn-success rent-property w-100" data-property-id="${id}">
                    <i class="bi bi-house-check"></i> Rent Property
                </button>
                <button class="btn btn-outline-info w-100 view-reviews" data-property-id="${id}">
                    <i class="bi bi-chat-dots"></i> View Reviews
                </button>
            </div>
        </div>
    `;

    const buyButton = div.querySelector('.buy-shares');
    if (buyButton) {
        buyButton.addEventListener('click', () => {
            console.log('Buy shares clicked for property:', id);
            showPurchaseModal(id, property);
        });
    }

    const rentButton = div.querySelector('.rent-property');
    if (rentButton) {
        rentButton.addEventListener('click', async () => {
            try {
                // Get the latest property data
                const propertyData = await propertyContract.methods.properties(id).call();

                // Check if property is already rented
                try {
                    const rental = await propertyContract.methods.getRentalDetails(id).call();
                    if (rental && rental.isActive) {
                        showError('This property is already rented');
                        loadProperties(); // Refresh the display
                        return;
                    }
                } catch (error) {
                    // If getRentalDetails fails, property is not rented
                    console.log('Property not rented yet:', error);
                }

                showRentModal(id, propertyData);
            } catch (error) {
                console.error('Error checking rental status:', error);
                showError('Failed to check rental status: ' + error.message);
            }
        });
    }

    const viewReviewsButton = div.querySelector('.view-reviews');
    viewReviewsButton.addEventListener('click', () => showPropertyReviews(id, property));

    return div;
}

function showPurchaseModal(propertyId, property) {
    console.log('Showing purchase modal for property:', propertyId);
    selectedPropertyId = propertyId;

    // Update modal content
    document.getElementById('propertyDetails').innerHTML = `
        <p><strong>Property:</strong> ${property.name}</p>
        <p><strong>Location:</strong> ${property.location}</p>
        <p><strong>Available Shares:</strong> ${property.availableShares}</p>
        <p><strong>Price per Share:</strong> ${web3.utils.fromWei(property.pricePerShare, 'ether')} ETH</p>
    `;

    // Reset share amount input
    const shareInput = document.getElementById('shareAmount');
    shareInput.value = '';
    shareInput.max = property.availableShares;
    document.getElementById('totalCost').textContent = '0 ETH';

    // Show the modal
    const purchaseModalEl = document.getElementById('purchaseModal');
    const purchaseModal = new bootstrap.Modal(purchaseModalEl);
    purchaseModal.show();
}

async function loadPortfolio() {
    await updateDashboardStats();
    
    const myInvestments = document.getElementById('myInvestments');
    const myListings = document.getElementById('myListings');
    
    myInvestments.innerHTML = '<tr><td colspan="6" class="text-center"><div class="spinner-border text-primary" role="status"></div></td></tr>';
    myListings.innerHTML = '<tr><td colspan="6" class="text-center"><div class="spinner-border text-primary" role="status"></div></td></tr>';

    try {
        const count = await propertyContract.methods.propertyCount().call();
        let hasInvestments = false;
        let hasListings = false;
        
        myInvestments.innerHTML = '';
        myListings.innerHTML = '';
        
        for (let i = 1; i <= count; i++) {
            const property = await propertyContract.methods.properties(i).call();
            const shares = await propertyContract.methods.getPropertyShares(i, userAccount).call();

            if (parseInt(shares) > 0) {
                const investmentRow = await createInvestmentCard(i, property, shares);
                myInvestments.appendChild(investmentRow);
                hasInvestments = true;
            }

            if (property.owner.toLowerCase() === userAccount.toLowerCase()) {
                const listingRow = await createListingCard(i, property);
                myListings.appendChild(listingRow);
                hasListings = true;
            }
        }

        if (!hasInvestments) {
            myInvestments.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center">
                        <div class="alert alert-info mb-0">
                            <i class="bi bi-info-circle"></i> You don't have any investments yet
                        </div>
                    </td>
                </tr>
            `;
        }
        
        if (!hasListings) {
            myListings.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center">
                        <div class="alert alert-info mb-0">
                            <i class="bi bi-info-circle"></i> You haven't listed any properties
                        </div>
                    </td>
                </tr>
            `;
        }
    } catch (error) {
        console.error('Error loading portfolio:', error);
        const errorMessage = `
            <tr>
                <td colspan="6" class="text-center">
                    <div class="alert alert-danger mb-0">
                        <i class="bi bi-exclamation-triangle"></i> Error loading data: ${error.message}
                    </div>
                </td>
            </tr>
        `;
        myInvestments.innerHTML = errorMessage;
        myListings.innerHTML = errorMessage;
    }
}

async function createInvestmentCard(id, property, shares) {
    const tr = document.createElement('tr');
    
    try {
        if (parseInt(shares) > 0) {
            const shareValue = web3.utils.fromWei(property.pricePerShare, 'ether');
            const totalValue = (parseFloat(shareValue) * parseInt(shares)).toFixed(4);
            const dividendsReceived = await getPropertyDividends(id, userAccount);
            
            tr.innerHTML = `
                <td>${property.name}</td>
                <td>${property.location}</td>
                <td>${shares}</td>
                <td>${totalValue} ETH</td>
                <td>${dividendsReceived.toFixed(4)} ETH</td>
                <td>
                    <div class="btn-group">
                        <button class="btn btn-sm btn-outline-primary add-review" data-property-id="${id}">
                            <i class="bi bi-star"></i> Review
                        </button>
                        <button class="btn btn-sm btn-outline-info view-reviews" data-property-id="${id}">
                            <i class="bi bi-chat-dots"></i> View Reviews
                        </button>
                    </div>
                </td>
            `;

            const reviewButton = tr.querySelector('.add-review');
            reviewButton.addEventListener('click', () => showReviewModal(id));

            const viewReviewsButton = tr.querySelector('.view-reviews');
            viewReviewsButton.addEventListener('click', () => showPropertyReviews(id, property));
        }
        
        return tr;
    } catch (error) {
        console.error('Error creating investment card:', error);
        tr.innerHTML = `
            <td colspan="6" class="text-center">
                <div class="alert alert-danger mb-0">
                    <i class="bi bi-exclamation-triangle"></i> Error loading investment data
                </div>
            </td>
        `;
        return tr;
    }
}

async function createListingCard(id, property) {
    const tr = document.createElement('tr');
    
    try {
        const totalValue = web3.utils.fromWei(property.totalValue.toString(), 'ether');
        const sharesSold = property.totalShares - property.availableShares;
        
        // Check if owner has any shares
        const ownerShares = await propertyContract.methods.getPropertyShares(id, userAccount).call();
        const hasShares = parseInt(ownerShares) > 0;

        // Get total dividends distributed
        const events = await propertyContract.getPastEvents('ShareholderDividendSent', {
            filter: { propertyId: id },
            fromBlock: 0,
            toBlock: 'latest'
        });

        let totalDividendsDistributed = 0;
        if (events && events.length > 0) {
            events.forEach(event => {
                if (event.returnValues && event.returnValues.amount) {
                    totalDividendsDistributed += parseFloat(web3.utils.fromWei(event.returnValues.amount, 'ether'));
                }
            });
        }
        
        tr.innerHTML = `
            <td>${property.name}</td>
            <td>${property.location}</td>
            <td>${totalValue} ETH</td>
            <td>${sharesSold}/${property.totalShares}</td>
            <td>${totalDividendsDistributed.toFixed(4)} ETH</td>
            <td>
                <button class="btn btn-sm btn-success distribute-dividends" 
                    data-property-id="${id}" 
                    ${!hasShares ? 'disabled title="You must own shares to distribute dividends"' : ''}>
                    <i class="bi bi-cash-coin"></i> Distribute
                </button>
            </td>
        `;

        const distributeButton = tr.querySelector('.distribute-dividends');
        if (hasShares) {
            distributeButton.addEventListener('click', async () => {
                const amount = prompt('Enter dividend amount in ETH:');
                if (amount && !isNaN(amount) && parseFloat(amount) > 0) {
                    await distributeDividends(id, amount);
                } else if (amount !== null) {
                    showError('Please enter a valid amount');
                }
            });
        }

        return tr;
    } catch (error) {
        console.error('Error creating listing card:', error);
        tr.innerHTML = `
            <td colspan="6" class="text-center">
                <div class="alert alert-danger mb-0">
                    <i class="bi bi-exclamation-triangle"></i> Error loading property data
                </div>
            </td>
        `;
        return tr;
    }
}

async function getPropertyDividends(propertyId, userAddress) {
    try {
        const latestBlock = await web3.eth.getBlockNumber();
        
        const events = await propertyContract.getPastEvents('ShareholderDividendSent', {
            filter: { 
                propertyId: propertyId,
                shareholder: userAddress
            },
            fromBlock: 0,
            toBlock: latestBlock
        });

        console.log(`Dividend events for property ${propertyId}:`, events);

        let totalDividends = 0;
        if (events && events.length > 0) {
            for (const event of events) {
                if (event.returnValues && event.returnValues.amount) {
                    const amount = web3.utils.fromWei(event.returnValues.amount, 'ether');
                    console.log(`Dividend amount: ${amount} ETH`);
                    totalDividends += parseFloat(amount);
                }
            }
        }

        console.log(`Total dividends for property ${propertyId}: ${totalDividends} ETH`);
        return totalDividends;
    } catch (error) {
        console.error('Error getting dividends:', error);
        return 0;
    }
}

async function updateDashboardStats() {
    try {
        let totalInvestment = 0;
        let totalDividends = 0;
        let propertiesOwned = 0;
        let activeInvestments = 0;

        const count = await propertyContract.methods.propertyCount().call();
        
        for (let i = 1; i <= count; i++) {
            const property = await propertyContract.methods.properties(i).call();
            const shares = await propertyContract.methods.getPropertyShares(i, userAccount).call();
            
            if (parseInt(shares) > 0) {
                activeInvestments++;
                const shareValue = web3.utils.fromWei(property.pricePerShare.toString(), 'ether');
                totalInvestment += parseFloat(shareValue) * parseInt(shares);
                
                // Get all dividend events for this property where the user is the recipient
                const events = await propertyContract.getPastEvents('ShareholderDividendSent', {
                    filter: { 
                        propertyId: i,
                        shareholder: userAccount
                    },
                    fromBlock: 0,
                    toBlock: 'latest'
                });

                console.log(`Dividend events for property ${i}:`, events);

                // Sum up all dividends received
                if (events && events.length > 0) {
                    for (const event of events) {
                        if (event.returnValues && event.returnValues.dividendAmount) {
                            const amount = web3.utils.fromWei(event.returnValues.dividendAmount, 'ether');
                            console.log(`Received dividend: ${amount} ETH`);
                            totalDividends += parseFloat(amount);
                        }
                    }
                }
            }

            if (property.owner.toLowerCase() === userAccount.toLowerCase()) {
                propertiesOwned++;
            }
        }

        console.log('Dashboard stats:', {
            totalInvestment,
            totalDividends,
            propertiesOwned,
            activeInvestments
        });

        document.getElementById('totalInvestments').textContent = totalInvestment.toFixed(4) + ' ETH';
        document.getElementById('propertiesOwned').textContent = propertiesOwned;
        document.getElementById('totalDividends').textContent = totalDividends.toFixed(4) + ' ETH';
        document.getElementById('activeInvestments').textContent = activeInvestments;

        // Add transaction history button to dashboard
        const dashboardButtons = document.createElement('div');
        dashboardButtons.className = 'mt-3';
        dashboardButtons.innerHTML = `
            <button class="btn btn-info" onclick="showTransactionHistory()">
                <i class="bi bi-clock-history"></i> View Dividend History
            </button>
        `;
        
        // Find a good place to insert the button (after the stats)
        const dashboardStats = document.querySelector('.dashboard-stats');
        if (dashboardStats && !document.querySelector('.transaction-history-btn')) {
            dashboardStats.appendChild(dashboardButtons);
        }

    } catch (error) {
        console.error('Error updating dashboard:', error);
        showError('Error updating dashboard statistics');
    }
}

async function distributeDividends(propertyId, amount) {
    try {
        showLoading('Distributing dividends...');
        
        const property = await propertyContract.methods.properties(propertyId).call();
        if (property.owner.toLowerCase() !== userAccount.toLowerCase()) {
            throw new Error('Only the property owner can distribute dividends');
        }

        const totalShares = BigInt(property.totalShares) - BigInt(property.availableShares);
        if (totalShares <= 0) {
            throw new Error('No shares have been purchased yet');
        }

        const shareholderInfo = await propertyContract.methods.getPropertyShareholders(propertyId).call();
        const shareholders = shareholderInfo[0]; 
        if (!shareholders || shareholders.length === 0) {
            throw new Error('No shareholders found for this property');
        }

        const valueInWei = web3.utils.toWei(amount.toString(), 'ether');
        console.log('Distributing dividends:', {
            propertyId,
            amount: amount + ' ETH',
            valueInWei,
            totalShares: totalShares.toString()
        });

        const tx = await propertyContract.methods.distributeDividends(propertyId)
            .send({
                from: userAccount,
                value: valueInWei,
                gas: 3000000
            });
        
        console.log('Distribution transaction:', tx);

        // Wait for a moment to ensure events are processed
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Refresh the display
        await loadPortfolio();
        await updateDashboardStats();
        
        showSuccess('Dividends distributed successfully!');
        
    } catch (error) {
        console.error('Dividend distribution error:', error);
        showError('Failed to distribute dividends: ' + (error.message || error));
    }
}

function formatAddress(address) {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

function showLoading(message) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-info alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3';
    alert.style.zIndex = '1050';
    alert.innerHTML = `
        <div class="d-flex align-items-center">
            <div class="spinner-border spinner-border-sm me-2" role="status"></div>
            ${message}
        </div>
    `;
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 3000);
}

function showSuccess(message) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-success alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3';
    alert.style.zIndex = '1050';
    alert.innerHTML = `
        <i class="bi bi-check-circle me-2"></i>${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 3000);
}

function showError(message) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3';
    alert.style.zIndex = '1050';
    alert.innerHTML = `
        <i class="bi bi-exclamation-triangle me-2"></i>${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 5000);
}

window.addEventListener('load', () => {
    if (typeof window.ethereum !== 'undefined') {
        const purchaseModalEl = document.getElementById('purchaseModal');
        if (purchaseModalEl) {
            window.purchaseModal = new bootstrap.Modal(purchaseModalEl);
        }
        init();
    } else {
        document.getElementById('userStatus').innerHTML = `
            <i class="bi bi-exclamation-triangle"></i> Please install MetaMask
        `;
    }
});

async function showReviewModal(propertyId) {
    try {
        if (!propertyContract || !propertyContract.methods) {
            throw new Error('Contract not initialized. Please refresh the page.');
        }

        const shares = await propertyContract.methods.getPropertyShares(propertyId, userAccount).call();
        if (parseInt(shares) <= 0) {
            throw new Error('You must own shares to review this property');
        }

        const hasReviewed = await propertyContract.methods.hasReviewed(propertyId, userAccount).call();
        if (hasReviewed) {
            throw new Error('You have already reviewed this property');
        }

        const modalHtml = `
            <div class="modal fade" id="reviewModal" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Add Review</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <form id="reviewForm">
                                <div class="mb-3">
                                    <label class="form-label">Rating</label>
                                    <div class="rating">
                                        ${[5,4,3,2,1].map(num => `
                                            <input type="radio" name="rating" value="${num}" id="star${num}">
                                            <label for="star${num}"><i class="bi bi-star-fill"></i></label>
                                        `).join('')}
                                    </div>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Comment</label>
                                    <textarea class="form-control" id="reviewComment" rows="3" required></textarea>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="submitReview">Submit Review</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existingModal = document.getElementById('reviewModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to document
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Initialize modal
        const modal = new bootstrap.Modal(document.getElementById('reviewModal'));
        modal.show();

        // Handle review submission
        document.getElementById('submitReview').addEventListener('click', async () => {
            const rating = document.querySelector('input[name="rating"]:checked')?.value;
            const comment = document.getElementById('reviewComment').value;

            if (!rating || !comment) {
                showError('Please provide both rating and comment');
                return;
            }

            try {
                showLoading('Submitting review...');
                await propertyContract.methods.addReview(propertyId, rating, comment)
                    .send({ from: userAccount });
                
                modal.hide();
                showSuccess('Review submitted successfully!');
                
                // Reload reviews
                const reviewsSection = document.querySelector(`#reviews-${propertyId}`);
                if (reviewsSection) {
                    loadPropertyReviews(propertyId, reviewsSection);
                }
            } catch (error) {
                console.error('Review submission error:', error);
                showError('Failed to submit review: ' + error.message);
            }
        });
    } catch (error) {
        console.error('Error showing review modal:', error);
        showError('Failed to show review modal: ' + error.message);
    }
}

async function loadPropertyReviews(propertyId, container) {
    try {
        if (!propertyContract || !propertyContract.methods) {
            throw new Error('Contract not initialized');
        }

        // Get property rating
        const ratingResult = await propertyContract.methods.getPropertyRating(propertyId).call();
        const averageRating = ratingResult[0];
        const numReviews = ratingResult[1];

        // Get reviews
        const reviews = await propertyContract.methods.getPropertyReviews(propertyId).call();
        console.log('Reviews:', reviews); // Debug log

        let html = `
            <div class="property-rating mb-2">
                <h6>
                    Rating: ${numReviews > 0 ? (averageRating / numReviews).toFixed(1) : 'No ratings'} 
                    <i class="bi bi-star-fill text-warning"></i>
                    <small class="text-muted">(${numReviews} reviews)</small>
                </h6>
            </div>
        `;

        if (reviews && Array.isArray(reviews) && reviews.length > 0) {
            html += '<div class="reviews-list">';
            reviews.forEach(review => {
                // Check if review has all required properties
                if (review && review.reviewer && review.rating && review.comment && review.timestamp) {
                    const date = new Date(parseInt(review.timestamp) * 1000);
                    html += `
                        <div class="review-item border-bottom py-2">
                            <div class="d-flex justify-content-between">
                                <div>
                                    <span class="text-warning">
                                        ${'★'.repeat(parseInt(review.rating))}${'☆'.repeat(5 - parseInt(review.rating))}
                                    </span>
                                    <small class="text-muted">by ${formatAddress(review.reviewer)}</small>
                                </div>
                                <small class="text-muted">
                                    ${date.toLocaleDateString()}
                                </small>
                            </div>
                            <p class="mb-0 small">${review.comment}</p>
                        </div>
                    `;
                }
            });
            html += '</div>';
        } else {
            html += `
                <div class="alert alert-info">
                    <i class="bi bi-info-circle"></i> No reviews yet
                </div>
            `;
        }

        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading reviews:', error);
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="bi bi-exclamation-triangle"></i> Error loading reviews: ${error.message}
            </div>
        `;
    }
}

// Add CSS styles to the document
const style = document.createElement('style');
style.textContent = `
    .rating {
        display: flex;
        flex-direction: row-reverse;
        justify-content: flex-end;
    }
    .rating input {
        display: none;
    }
    .rating label {
        cursor: pointer;
        padding: 5px;
        color: #ddd;
    }
    .rating input:checked ~ label {
        color: #ffd700;
    }
    .rating label:hover,
    .rating label:hover ~ label {
        color: #ffd700;
    }
    .reviews-list {
        max-height: 300px;
        overflow-y: auto;
    }
`;
document.head.appendChild(style);

// Add property search and filter functionality
function setupPropertyFilters() {
    const searchInput = document.getElementById('propertySearch');
    const sortSelect = document.getElementById('propertySortFilter');

    searchInput.addEventListener('input', filterProperties);
    sortSelect.addEventListener('change', filterProperties);
}

function filterProperties() {
    const searchTerm = document.getElementById('propertySearch').value.toLowerCase();
    const sortBy = document.getElementById('propertySortFilter').value;
    const propertyCards = Array.from(document.querySelectorAll('.property-card'));

    // Filter by search term
    const filteredCards = propertyCards.filter(card => {
        const name = card.querySelector('h5').textContent.toLowerCase();
        const location = card.querySelector('.bi-geo-alt').parentElement.textContent.toLowerCase();
        return name.includes(searchTerm) || location.includes(searchTerm);
    });

    // Sort properties
    filteredCards.sort((a, b) => {
        const getPropertyValue = (card) => {
            switch (sortBy) {
                case 'value-high':
                case 'value-low':
                    return parseFloat(card.querySelector('.stat-value').textContent);
                case 'shares-available':
                    const shares = card.querySelector('small.text-muted').textContent.split('/')[0];
                    return parseInt(shares);
                default: // 'newest'
                    return parseInt(card.dataset.propertyId);
            }
        };

        const aValue = getPropertyValue(a);
        const bValue = getPropertyValue(b);

        return sortBy === 'value-low' ? aValue - bValue : bValue - aValue;
    });

    // Update display
    const propertyList = document.getElementById('propertyList');
    propertyList.innerHTML = '';
    filteredCards.forEach(card => propertyList.appendChild(card));
}

// Add new function to show property reviews
async function showPropertyReviews(propertyId, property) {
    try {
        if (!reviewsModal) {
            showError('Reviews modal not initialized. Please refresh the page.');
            return;
        }

        // Update property details in modal
        const propertyReviewsDetails = document.getElementById('propertyReviewsDetails');
        if (!propertyReviewsDetails) {
            showError('Reviews modal elements not found. Please refresh the page.');
            return;
        }

        propertyReviewsDetails.innerHTML = `
            <div class="text-center mb-3">
                <img src="${DEFAULT_PROPERTY_IMAGE}" class="property-image" style="height: 150px;" alt="${property.name}">
            </div>
            <h5>${property.name}</h5>
            <p class="text-muted"><i class="bi bi-geo-alt"></i> ${property.location}</p>
        `;

        // Get property rating
        const ratingResult = await propertyContract.methods.getPropertyRating(propertyId).call();
        const averageRating = ratingResult[0];
        const numReviews = ratingResult[1];

        // Update rating display
        const ratingHtml = `
            <h6>
                Rating: ${numReviews > 0 ? (averageRating / numReviews).toFixed(1) : 'No ratings'} 
                <i class="bi bi-star-fill text-warning"></i>
                <small class="text-muted">(${numReviews} reviews)</small>
            </h6>
        `;
        document.querySelector('#reviewsModal .property-rating').innerHTML = ratingHtml;

        // Get and display reviews
        const reviews = await propertyContract.methods.getPropertyReviews(propertyId).call();
        const reviewsList = document.getElementById('reviewsList');
        
        if (reviews && reviews.length > 0) {
            let reviewsHtml = '';
            reviews.forEach(review => {
                const date = new Date(parseInt(review.timestamp) * 1000);
                reviewsHtml += `
                    <div class="review-item border-bottom py-2">
                        <div class="d-flex justify-content-between">
                            <div>
                                <span class="text-warning">
                                    ${'★'.repeat(parseInt(review.rating))}${'☆'.repeat(5 - parseInt(review.rating))}
                                </span>
                                <small class="text-muted">by ${formatAddress(review.reviewer)}</small>
                            </div>
                            <small class="text-muted">
                                ${date.toLocaleDateString()}
                            </small>
                        </div>
                        <p class="mb-0 mt-2">${review.comment}</p>
                    </div>
                `;
            });
            reviewsList.innerHTML = reviewsHtml;
        } else {
            reviewsList.innerHTML = `
                <div class="alert alert-info">
                    <i class="bi bi-info-circle"></i> No reviews yet
                </div>
            `;
        }

        // Show the modal
        reviewsModal.show();
    } catch (error) {
        console.error('Error loading reviews:', error);
        showError('Failed to load reviews: ' + error.message);
    }
}

// Add function to refresh data periodically
function startAutoRefresh() {
    // Refresh every 30 seconds
    setInterval(async () => {
        try {
            await loadPortfolio();
            await updateDashboardStats();
        } catch (error) {
            console.error('Auto refresh error:', error);
        }
    }, 30000);
}

async function showTransactionHistory() {
    try {
        showLoading('Loading transaction history...');
        const transactions = [];
        const count = await propertyContract.methods.propertyCount().call();

        // Get all dividend events where the user is the recipient
        const events = await propertyContract.getPastEvents('ShareholderDividendSent', {
            filter: { shareholder: userAccount },
            fromBlock: 0,
            toBlock: 'latest'
        });

        // Process each event
        for (const event of events) {
            const propertyId = event.returnValues.propertyId;
            const property = await propertyContract.methods.getProperty(propertyId).call();
            const amount = web3.utils.fromWei(event.returnValues.dividendAmount, 'ether');
            const block = await web3.eth.getBlock(event.blockNumber);
            
            transactions.push({
                date: new Date(block.timestamp * 1000),
                propertyName: property.name,
                propertyLocation: property.location,
                amount: amount,
                from: property.owner, // Use property owner address instead of Unknown
                propertyId: propertyId,
                txHash: event.transactionHash
            });
        }

        // Sort transactions by date (newest first)
        transactions.sort((a, b) => b.date - a.date);

        // Create modal content
        const modalContent = `
            <div class="modal fade" id="transactionHistoryModal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Dividend Transaction History</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            ${transactions.length > 0 ? `
                                <div class="row mb-3">
                                    <div class="col-md-4">
                                        <input type="text" class="form-control" id="txHistorySearch" 
                                            placeholder="Search by property name...">
                                    </div>
                                    <div class="col-md-3">
                                        <select class="form-select" id="txHistorySort">
                                            <option value="date-desc">Newest First</option>
                                            <option value="date-asc">Oldest First</option>
                                            <option value="amount-desc">Highest Amount</option>
                                            <option value="amount-asc">Lowest Amount</option>
                                        </select>
                                    </div>
                                    <div class="col-md-5 text-end">
                                        <button class="btn btn-success" onclick="exportTransactionHistory()">
                                            <i class="bi bi-file-earmark-excel"></i> Export to CSV
                                        </button>
                                    </div>
                                </div>
                                <div class="table-responsive">
                                    <table class="table" id="txHistoryTable">
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Property</th>
                                                <th>Location</th>
                                                <th>Amount (ETH)</th>
                                                <th>From</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${transactions.map(tx => `
                                                <tr data-amount="${tx.amount}" data-property="${tx.propertyName.toLowerCase()}">
                                                    <td>${tx.date.toLocaleString()}</td>
                                                    <td>${tx.propertyName}</td>
                                                    <td>${tx.propertyLocation}</td>
                                                    <td>${parseFloat(tx.amount).toFixed(4)}</td>
                                                    <td>
                                                        <a href="https://sepolia.etherscan.io/address/${tx.from}" 
                                                           target="_blank" title="View on Etherscan">
                                                            ${formatAddress(tx.from)}
                                                        </a>
                                                    </td>
                                                    <td>
                                                        <a href="https://sepolia.etherscan.io/tx/${tx.txHash}" 
                                                           class="btn btn-sm btn-outline-info" 
                                                           target="_blank" title="View transaction on Etherscan">
                                                            <i class="bi bi-box-arrow-up-right"></i>
                                                        </a>
                                                    </td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                                <div class="mt-3">
                                    <strong>Total Dividends Received: </strong>
                                    ${transactions.reduce((sum, tx) => sum + parseFloat(tx.amount), 0).toFixed(4)} ETH
                                </div>
                            ` : `
                                <div class="alert alert-info">
                                    <i class="bi bi-info-circle"></i> No dividend transactions found
                                </div>
                            `}
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        const existingModal = document.getElementById('transactionHistoryModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Add modal to document
        document.body.insertAdjacentHTML('beforeend', modalContent);

        // Initialize and show modal
        transactionHistoryModal = new bootstrap.Modal(document.getElementById('transactionHistoryModal'));
        transactionHistoryModal.show();

        // Setup search and sort functionality
        const txHistorySearch = document.getElementById('txHistorySearch');
        const txHistorySort = document.getElementById('txHistorySort');
        
        if (txHistorySearch && txHistorySort) {
            txHistorySearch.addEventListener('input', filterTransactions);
            txHistorySort.addEventListener('change', filterTransactions);
        }

    } catch (error) {
        console.error('Error loading transaction history:', error);
        showError('Failed to load transaction history: ' + error.message);
    }
}

function filterTransactions() {
    const searchTerm = document.getElementById('txHistorySearch').value.toLowerCase();
    const sortOption = document.getElementById('txHistorySort').value;
    const tbody = document.querySelector('#txHistoryTable tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    // Filter rows
    const filteredRows = rows.filter(row => {
        const propertyName = row.getAttribute('data-property');
        return propertyName.includes(searchTerm);
    });

    // Sort rows
    filteredRows.sort((a, b) => {
        switch (sortOption) {
            case 'date-asc':
                return new Date(a.cells[0].textContent) - new Date(b.cells[0].textContent);
            case 'date-desc':
                return new Date(b.cells[0].textContent) - new Date(a.cells[0].textContent);
            case 'amount-asc':
                return parseFloat(a.getAttribute('data-amount')) - parseFloat(b.getAttribute('data-amount'));
            case 'amount-desc':
                return parseFloat(b.getAttribute('data-amount')) - parseFloat(a.getAttribute('data-amount'));
            default:
                return 0;
        }
    });

    // Update table
    tbody.innerHTML = '';
    filteredRows.forEach(row => tbody.appendChild(row));
}

function exportTransactionHistory() {
    const table = document.getElementById('txHistoryTable');
    const rows = Array.from(table.querySelectorAll('tr'));
    
    let csv = 'Date,Property,Location,Amount (ETH),From,Transaction Hash\n';
    
    rows.forEach((row, index) => {
        if (index === 0) return; // Skip header row
        const cells = Array.from(row.cells);
        const txHash = cells[5].querySelector('a').href.split('/').pop();
        const values = [
            cells[0].textContent,
            cells[1].textContent,
            cells[2].textContent,
            cells[3].textContent,
            cells[4].textContent,
            txHash
        ];
        csv += values.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dividend_transactions.csv';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
}

function showRentModal(propertyId, property) {
    console.log('Opening rental modal for property:', propertyId, property);
    try {
        // Calculate yearly rent (50% of property value)
        const yearlyRent = BigInt(property.totalValue) / BigInt(2);
        const yearlyRentEth = web3.utils.fromWei(yearlyRent.toString(), 'ether');
        console.log('Calculated yearly rent:', yearlyRentEth, 'ETH');

        // Remove existing modal if it exists
        const existingModal = document.getElementById('rentalModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create new modal
        const modalHtml = `
            <div class="modal fade" id="rentalModal" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Confirm Property Rental</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div id="rentalPropertyDetails"></div>
                            <div class="mb-3">
                                <label class="form-label">Rental Duration (years)</label>
                                <input type="number" class="form-control" id="rentalDuration" min="1" max="10" value="1">
                                <small class="text-muted">Minimum: 1 year, Maximum: 10 years</small>
                            </div>
                            <div class="rental-terms">
                                <h6>Rental Terms</h6>
                                <p>Yearly Rent: <span id="yearlyRentAmount">0</span> ETH</p>
                                <p>Total Rent: <span id="totalRentAmount">0</span> ETH</p>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" onclick="confirmRental()">
                                Confirm Rental
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Update modal content
        document.getElementById('rentalPropertyDetails').innerHTML = `
            <div class="mb-3">
                <h6>Property Details</h6>
                <p class="mb-1">Name: ${property.name}</p>
                <p class="mb-1">Location: ${property.location}</p>
                <p class="mb-1">Value: ${web3.utils.fromWei(property.totalValue, 'ether')} ETH</p>
            </div>
        `;
        
        // Store property ID and yearly rent in the modal
        const rentalModal = document.getElementById('rentalModal');
        rentalModal.dataset.propertyId = propertyId;
        rentalModal.dataset.yearlyRent = yearlyRentEth;
        
        // Set up event listeners
        document.getElementById('rentalDuration').addEventListener('input', updateRentAmount);
        
        // Update initial amounts
        document.getElementById('yearlyRentAmount').textContent = yearlyRentEth;
        document.getElementById('rentalDuration').value = '1';
        updateRentAmount();
        
        // Show the modal
        const bsRentalModal = new bootstrap.Modal(rentalModal);
        bsRentalModal.show();

        console.log('Rental modal setup complete');
    } catch (error) {
        console.error('Error showing rental modal:', error);
        showError('Failed to show rental modal: ' + error.message);
    }
}

function updateRentAmount() {
    try {
        const rentalModal = document.getElementById('rentalModal');
        const duration = parseInt(document.getElementById('rentalDuration').value) || 0;
        const yearlyRent = parseFloat(rentalModal.dataset.yearlyRent) || 0;
        const totalRent = (yearlyRent * duration).toFixed(4);
        document.getElementById('totalRentAmount').textContent = totalRent;
        console.log('Updated rent amount:', { duration, yearlyRent, totalRent });
    } catch (error) {
        console.error('Error updating rent amount:', error);
    }
}

async function confirmRental() {
    console.log('Confirm rental clicked');
    try {
        const rentalModal = document.getElementById('rentalModal');
        const propertyId = rentalModal.dataset.propertyId;
        const duration = parseInt(document.getElementById('rentalDuration').value);
        const totalRentText = document.getElementById('totalRentAmount').textContent;
        const totalRent = web3.utils.toWei(totalRentText.split(' ')[0], 'ether');

        console.log('Rental details:', {
            propertyId,
            duration,
            totalRent,
            userAccount
        });

        if (!propertyId) {
            throw new Error('Property ID not found');
        }

        if (duration < 1 || duration > 10) {
            throw new Error('Rental duration must be between 1 and 10 years');
        }

        showLoading('Processing rental transaction...');
        
        // Check user's balance
        const balance = await web3.eth.getBalance(userAccount);
        if (BigInt(balance) < BigInt(totalRent)) {
            throw new Error('Insufficient funds for rental payment');
        }

        // Get property details for rental data
        const property = await propertyContract.methods.properties(propertyId).call();
        console.log('Property details for rental:', property);
        
        // Calculate yearly rent
        const yearlyRent = BigInt(totalRent) / BigInt(duration);
        
        // Current timestamp in seconds
        const startDate = Math.floor(Date.now() / 1000);
        const endDate = startDate + (duration * 365 * 24 * 60 * 60);

        console.log('Sending rental transaction...');
        const tx = await propertyContract.methods.rentProperty(propertyId, duration)
            .send({ 
                from: userAccount, 
                value: totalRent,
                gas: '3000000'
            });

        console.log('Rental transaction successful:', tx);

        // Save rental data to localStorage
        const rentalData = {
            propertyId: propertyId,
            tenant: userAccount,
            startDate: startDate,
            endDate: endDate,
            yearlyRent: yearlyRent.toString(),
            isActive: true
        };

        console.log('Saving rental data to localStorage:', rentalData);
        localStorage.setItem(`rental_${propertyId}`, JSON.stringify(rentalData));
        
        // Hide the modal
        const bsRentalModal = bootstrap.Modal.getInstance(rentalModal);
        if (bsRentalModal) {
            bsRentalModal.hide();
        }
        
        showSuccess('Property rented successfully!');
        
        // Refresh the UI
        await loadProperties();
        await loadUserRentals();
        
    } catch (error) {
        console.error('Error in rental confirmation:', error);
        showError('Failed to rent property: ' + error.message);
    } finally {
        hideLoading();
    }
}

function hideLoading() {
    const loadingAlert = document.querySelector('.alert-info.position-fixed');
    if (loadingAlert) {
        loadingAlert.remove();
    }
}

async function loadUserRentals() {
    console.log('Loading user rentals...');
    const rentalsList = document.getElementById('myRentals');
    if (!rentalsList) {
        console.error('Rentals container not found');
        return;
    }

    try {
        // Debug: Log all localStorage items
        console.log('All localStorage items:');
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('rental_')) {
                console.log(`Found rental data: ${key}:`, localStorage.getItem(key));
            }
        }

        console.log('Current user account:', userAccount);

        rentalsList.innerHTML = '<tr><td colspan="7" class="text-center"><div class="spinner-border text-primary"></div></td></tr>';
        
        // Get total number of properties
        const count = await propertyContract.methods.propertyCount().call();
        console.log('Total properties:', count);
        
        let hasRentals = false;
        let html = '';

        // Loop through all properties to find rentals
        for (let i = 1; i <= count; i++) {
            try {
                // Try to get property using properties method
                let property;
                try {
                    property = await propertyContract.methods.properties(i).call();
                    console.log(`Got property ${i} using properties():`, property);
                } catch (propError) {
                    console.log(`Failed to get property ${i} using properties(), trying getProperty():`, propError);
                    try {
                        property = await propertyContract.methods.getProperty(i).call();
                        console.log(`Got property ${i} using getProperty():`, property);
                    } catch (getPropError) {
                        console.error(`Failed to get property ${i} using both methods:`, getPropError);
                        continue;
                    }
                }

                // Get rental data from localStorage
                const rentalData = localStorage.getItem(`rental_${i}`);
                console.log(`Checking rental data for property ${i}:`, rentalData);

                if (rentalData) {
                    const rental = JSON.parse(rentalData);
                    console.log(`Parsed rental data for property ${i}:`, rental);
                    console.log(`Comparing addresses - Rental tenant: ${rental.tenant.toLowerCase()} vs Current user: ${userAccount.toLowerCase()}`);

                    // Check if this rental belongs to current user
                    if (rental.tenant && rental.tenant.toLowerCase() === userAccount.toLowerCase()) {
                        console.log(`Match found! Property ${i} is rented by current user`);
                        
                        const now = Math.floor(Date.now() / 1000);
                        const status = now > rental.endDate ? 'Expired' : 
                                     now < rental.startDate ? 'Upcoming' : 'Active';
                        
                        const startDate = new Date(rental.startDate * 1000).toLocaleDateString();
                        const endDate = new Date(rental.endDate * 1000).toLocaleDateString();
                        const yearlyRentEth = web3.utils.fromWei(rental.yearlyRent.toString(), 'ether');
                        const duration = Math.floor((rental.endDate - rental.startDate) / (365 * 24 * 60 * 60));

                        hasRentals = true;
                        html += `
                            <tr>
                                <td>${property.name || 'Unknown'}</td>
                                <td>${property.location || 'Unknown'}</td>
                                <td>${yearlyRentEth} ETH</td>
                                <td>${startDate}</td>
                                <td>${endDate}</td>
                                <td>${duration} years</td>
                                <td>
                                    <span class="badge bg-${status === 'Active' ? 'success' : 
                                                     status === 'Expired' ? 'danger' : 'warning'}">
                                        ${status}
                                    </span>
                                </td>
                            </tr>
                        `;
                        console.log('Added rental row to display:', {
                            propertyId: i,
                            propertyName: property.name,
                            status,
                            startDate,
                            endDate,
                            duration,
                            yearlyRent: yearlyRentEth
                        });
                    }
                }
            } catch (error) {
                console.error(`Error loading rental for property ${i}:`, error);
                continue;
            }
        }

        if (!hasRentals) {
            console.log('No rentals found for user');
            rentalsList.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center">
                        <div class="alert alert-info mb-0">
                            <i class="bi bi-info-circle"></i> You haven't rented any properties yet
                        </div>
                    </td>
                </tr>
            `;
        } else {
            console.log('Displaying rentals:', html);
            rentalsList.innerHTML = html;
        }

    } catch (error) {
        console.error('Error loading rentals:', error);
        rentalsList.innerHTML = `
            <tr>
                <td colspan="7" class="text-center">
                    <div class="alert alert-danger mb-0">
                        <i class="bi bi-exclamation-triangle"></i> Error loading rentals: ${error.message}
                    </div>
                </td>
            </tr>
        `;
    }
}

// Make sure rentals tab is properly initialized
function addRentalsTab() {
    console.log('Adding rentals tab...');
    // Check if rentals tab already exists
    if (document.getElementById('rentals-tab')) {
        console.log('Rentals tab already exists');
        return;
    }

    const tabList = document.querySelector('.nav-pills');
    const tabContent = document.querySelector('.tab-content');

    if (!tabList || !tabContent) {
        console.error('Required DOM elements not found');
        return;
    }

    // Add tab button
    const tabButton = document.createElement('li');
    tabButton.className = 'nav-item';
    tabButton.innerHTML = `
        <a class="nav-link" id="rentals-tab" data-bs-toggle="pill" href="#rentals">
            <i class="bi bi-house-check"></i> My Rentals
        </a>
    `;
    tabList.appendChild(tabButton);

    // Add tab content
    const tabPane = document.createElement('div');
    tabPane.className = 'tab-pane fade';
    tabPane.id = 'rentals';
    tabPane.innerHTML = `
        <div class="card">
            <div class="card-header bg-success text-white">
                <h5 class="card-title mb-0">
                    <i class="bi bi-house-check"></i> My Rented Properties
                </h5>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead>
                            <tr>
                                <th>Property</th>
                                <th>Location</th>
                                <th>Yearly Rent</th>
                                <th>Start Date</th>
                                <th>End Date</th>
                                <th>Duration</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="myRentals">
                            <tr>
                                <td colspan="7" class="text-center">
                                    <div class="spinner-border text-primary"></div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    tabContent.appendChild(tabPane);

    // Add event listener to load rentals when tab is shown
    document.getElementById('rentals-tab').addEventListener('click', () => {
        console.log('Rentals tab clicked');
        loadUserRentals();
    });

    console.log('Rentals tab added successfully');
}

// Make sure to call addRentalsTab after successful registration
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('mainContent').style.display === 'block') {
        addRentalsTab();
    }
});

async function initializeContracts() {
    // ... existing code ...
    const rentalContractAddress = ''; // Add the deployed RealEstateRental contract address
    const RealEstateRental = await ethers.getContractFactory('RealEstateRental');
    rentalContract = await RealEstateRental.attach(rentalContractAddress);
}

async function rentProperty(propertyId, durationInYears) {
    try {
        showLoading("Processing rental transaction...");
        const property = await propertyContract.methods.properties(propertyId).call();
        const yearlyRent = web3.utils.toBN(property.value).div(web3.utils.toBN('2')); // 50% of property value
        const totalRent = yearlyRent.mul(web3.utils.toBN(durationInYears));
        
        await propertyContract.methods.rentProperty(propertyId, durationInYears).send({
            from: userAccount,
            value: totalRent.toString()
        });
        
        hideLoading();
        showSuccess("Property rented successfully!");
        await updateDashboardStats();
        await loadProperties();
        await loadRentalProperties();
    } catch (error) {
        console.error("Error renting property:", error);
        hideLoading();
        showError("Failed to rent property: " + error.message);
    }
}

function updateTotalRentAmount() {
    const duration = parseInt(document.getElementById('rentalDuration').value);
    const yearlyRent = parseFloat(document.getElementById('yearlyRentAmount').textContent);
    const totalRent = yearlyRent * duration;
    document.getElementById('totalRentAmount').textContent = totalRent.toFixed(4);
}

document.getElementById('rentalDuration').addEventListener('input', updateTotalRentAmount);

async function loadRentalProperties() {
    try {
        const rentalContainer = document.getElementById('rentalsContainer');
        rentalContainer.innerHTML = '';
        
        const propertyCount = await propertyContract.methods.getPropertyCount().call();
        for (let i = 0; i < propertyCount; i++) {
            const rental = await propertyContract.methods.propertyRentals(i).call();
            if (rental.tenant.toLowerCase() === userAccount.toLowerCase()) {
                const property = await propertyContract.methods.properties(i).call();
                const propertyCard = await createRentalPropertyCard(i, property, rental);
                rentalContainer.appendChild(propertyCard);
            }
        }
    } catch (error) {
        console.error("Error loading rental properties:", error);
        showError("Failed to load rental properties");
    }
}

function createRentalPropertyCard(propertyId, property, rental) {
    const card = document.createElement('div');
    card.className = 'col-md-4 mb-4';
    const startDate = new Date(rental.startDate * 1000);
    const endDate = new Date(rental.endDate * 1000);
    const yearlyRent = web3.utils.fromWei(web3.utils.toBN(property.value).div(web3.utils.toBN('2')).toString());
    
    card.innerHTML = `
        <div class="card">
            <div class="card-body">
                <h5 class="card-title">${property.name}</h5>
                <p class="card-text">Location: ${property.location}</p>
                <p class="card-text">Yearly Rent: ${yearlyRent} ETH</p>
                <p class="card-text">Rental Period: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}</p>
                <button class="btn btn-primary" onclick="window.open('https://etherscan.io/address/${property.owner}')">
                    View Owner
                </button>
            </div>
        </div>
    `;
    return card;
}

// Add this function to check localStorage data
function checkRentalData() {
    console.log('Checking all rental data in localStorage:');
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('rental_')) {
            const data = localStorage.getItem(key);
            console.log(`${key}:`, data);
            try {
                const parsed = JSON.parse(data);
                console.log('Parsed data:', parsed);
            } catch (e) {
                console.error('Failed to parse data for key:', key);
            }
        }
    }
}