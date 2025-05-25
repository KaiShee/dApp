pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RealEstate is ERC20, Ownable {
    struct Review {
        address reviewer;
        uint8 rating;
        string comment;
        uint256 timestamp;
    }

    struct Rental {
        address tenant;
        uint256 startDate;
        uint256 endDate;
        uint256 yearlyRent;
        bool isActive;
    }

    struct Property {
        string name;
        string location;
        uint256 totalValue;
        uint256 totalShares;
        uint256 availableShares;
        uint256 pricePerShare;
        bool isListed;
        address owner;
        uint256 totalRating;
        uint256 numberOfRatings;
        bool isRented;
        uint256 yearlyRentalFee;  // 50% of total value
    }

    mapping(uint256 => Property) public properties;
    mapping(address => bool) public registeredUsers;
    mapping(uint256 => mapping(address => uint256)) public propertyShares; 
    mapping(uint256 => Review[]) public propertyReviews;
    mapping(uint256 => mapping(address => bool)) public hasReviewed;
    uint256 public propertyCount;
    
    mapping(uint256 => address[]) private propertyShareholderList;
    mapping(uint256 => mapping(address => bool)) private isPropertyShareholder;

    mapping(uint256 => Rental) public propertyRentals;
    mapping(address => uint256[]) private userRentals;

    event PropertyListed(uint256 indexed propertyId, string name, uint256 totalShares, uint256 pricePerShare);
    event SharesPurchased(uint256 indexed propertyId, address buyer, uint256 shares);
    event UserRegistered(address user);
    event DividendDistributed(uint256 indexed propertyId, uint256 amount);
    event ReviewAdded(uint256 indexed propertyId, address indexed reviewer, uint8 rating, string comment);
    event ShareholderDividendSent(
        uint256 indexed propertyId,
        address indexed shareholder,
        uint256 shares,
        uint256 dividendAmount,
        address owner
    );
    event DebugDividends(
        uint256 propertyId,
        uint256 totalShares,
        uint256 dividendPerShare,
        uint256 shareholderCount
    );
    event DebugPropertyListing(
        uint256 propertyId,
        uint256 totalShares,
        uint256 ownerShares,
        uint256 availableShares,
        address owner
    );
    event PropertyRented(
        uint256 indexed propertyId,
        address indexed tenant,
        uint256 startDate,
        uint256 endDate,
        uint256 yearlyRent
    );
    event RentalPaymentDistributed(
        uint256 indexed propertyId,
        address indexed shareholder,
        uint256 amount,
        uint256 paymentDate
    );

    constructor() ERC20("RealEstate Token", "REST") {}

    // Modifiers
    modifier validPropertyId(uint256 _propertyId) {
        require(_propertyId > 0 && _propertyId <= propertyCount, "Invalid property ID");
        _;
    }

    modifier isPropertyOwner(uint256 _propertyId) {
        require(properties[_propertyId].owner == msg.sender, "Not property owner");
        _;
    }

    modifier isNotRented(uint256 _propertyId) {
        require(!properties[_propertyId].isRented, "Property is already rented");
        _;
    }

    modifier hasEnoughShares(uint256 _propertyId, uint256 _shares) {
        require(propertyShares[_propertyId][msg.sender] >= _shares, "Insufficient shares");
        _;
    }

    modifier isValidRentalDuration(uint256 _years) {
        require(_years >= 1 && _years <= 10, "Rental duration must be between 1 and 10 years");
        _;
    }

    function registerUser() public {
        require(!registeredUsers[msg.sender], "User already registered");
        registeredUsers[msg.sender] = true;
        emit UserRegistered(msg.sender);
    }

    function listProperty(
        string memory _name,
        string memory _location,
        uint256 _totalValue,
        uint256 _totalShares,
        uint256 _pricePerShare
    ) public {
        require(registeredUsers[msg.sender], "User not registered");
        require(_totalShares > 0, "Total shares must be greater than 0");
        require(_pricePerShare > 0, "Price per share must be greater than 0");
        
        propertyCount++;
        
        // Calculate owner's shares (50% of total)
        uint256 ownerShares = _totalShares / 2;
        
        // Debug log before property creation
        emit DebugPropertyListing(
            propertyCount,
            _totalShares,
            ownerShares,
            _totalShares - ownerShares,
            msg.sender
        );

        properties[propertyCount] = Property({
            name: _name,
            location: _location,
            totalValue: _totalValue,
            totalShares: _totalShares,
            availableShares: _totalShares - ownerShares,
            pricePerShare: _pricePerShare,
            isListed: true,
            owner: msg.sender,
            totalRating: 0,
            numberOfRatings: 0,
            isRented: false,
            yearlyRentalFee: 0
        });

        // Assign shares to owner directly
        propertyShares[propertyCount][msg.sender] = ownerShares;
        
        // Add owner to shareholders list
        if (!isPropertyShareholder[propertyCount][msg.sender]) {
            propertyShareholderList[propertyCount].push(msg.sender);
            isPropertyShareholder[propertyCount][msg.sender] = true;
        }
        
        // Mint tokens for owner's shares
        _mint(msg.sender, ownerShares);

        emit PropertyListed(propertyCount, _name, _totalShares, _pricePerShare);
        emit SharesPurchased(propertyCount, msg.sender, ownerShares);
    }

    function purchaseShares(uint256 _propertyId, uint256 _shares) 
        public 
        payable 
        validPropertyId(_propertyId)
    {
        require(registeredUsers[msg.sender], "User not registered");
        Property storage property = properties[_propertyId];
        require(property.isListed, "Property not listed");
        require(property.availableShares >= _shares, "Not enough shares available");
        
        // Owner can get shares without payment
        if (msg.sender != property.owner) {
            require(msg.value >= property.pricePerShare * _shares, "Insufficient payment");
        }

        property.availableShares -= _shares;
        propertyShares[_propertyId][msg.sender] += _shares;
        
        if (!isPropertyShareholder[_propertyId][msg.sender]) {
            propertyShareholderList[_propertyId].push(msg.sender);
            isPropertyShareholder[_propertyId][msg.sender] = true;
        }
        
        _mint(msg.sender, _shares);

        emit SharesPurchased(_propertyId, msg.sender, _shares);
    }

    function getPropertyShares(uint256 _propertyId, address _user) public view returns (uint256) {
        return propertyShares[_propertyId][_user];
    }

    function distributeDividends(uint256 _propertyId) 
        public 
        payable 
        validPropertyId(_propertyId)
        isPropertyOwner(_propertyId)
    {
        require(msg.value > 0, "Must send ETH for dividends");
        require(propertyShares[_propertyId][msg.sender] > 0, "Owner must have shares to distribute dividends");
        
        Property storage property = properties[_propertyId];
        uint256 totalSoldShares = property.totalShares - property.availableShares;
        require(totalSoldShares > 0, "No shares have been purchased yet");

        uint256 dividendPerShare = msg.value / totalSoldShares;
        uint256 remainingAmount = msg.value;

        address[] storage shareholders = propertyShareholderList[_propertyId];
        require(shareholders.length > 0, "No shareholders found");

        for (uint256 i = 0; i < shareholders.length; i++) {
            address shareholder = shareholders[i];
            uint256 shares = propertyShares[_propertyId][shareholder];
            
            if (shares > 0) {
                uint256 dividend = shares * dividendPerShare;
                remainingAmount -= dividend;

                (bool success, ) = payable(shareholder).call{value: dividend}("");
                require(success, "Failed to send dividend");

                emit ShareholderDividendSent(_propertyId, shareholder, shares, dividend, property.owner);
            }
        }

        if (remainingAmount > 0) {
            (bool success, ) = payable(msg.sender).call{value: remainingAmount}("");
            require(success, "Failed to return remaining amount");
        }

        emit DividendDistributed(_propertyId, msg.value);
    }

    function addressToString(address _addr) internal pure returns (string memory) {
        bytes32 value = bytes32(uint256(uint160(_addr)));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2+i*2] = alphabet[uint8(value[i + 12] >> 4)];
            str[3+i*2] = alphabet[uint8(value[i + 12] & 0x0f)];
        }
        return string(str);
    }

    function getShareholderDetails(uint256 _propertyId, address _shareholder) public view returns (
        uint256 shares,
        bool isShareholder
    ) {
        return (
            propertyShares[_propertyId][_shareholder],
            isPropertyShareholder[_propertyId][_shareholder]
        );
    }

    function isUserRegistered(address _user) public view returns (bool) {
        return registeredUsers[_user];
    }

    function getProperty(uint256 _propertyId) public view returns (
        string memory name,
        string memory location,
        uint256 totalValue,
        uint256 totalShares,
        uint256 availableShares,
        uint256 pricePerShare,
        bool isListed,
        address owner
    ) {
        Property storage property = properties[_propertyId];
        return (
            property.name,
            property.location,
            property.totalValue,
            property.totalShares,
            property.availableShares,
            property.pricePerShare,
            property.isListed,
            property.owner
        );
    }

    function addReview(uint256 _propertyId, uint8 _rating, string memory _comment) 
        public 
        validPropertyId(_propertyId)
        hasEnoughShares(_propertyId, 1)
    {
        require(registeredUsers[msg.sender], "User not registered");
        require(_rating >= 1 && _rating <= 5, "Rating must be between 1 and 5");
        require(!hasReviewed[_propertyId][msg.sender], "User has already reviewed this property");

        Property storage property = properties[_propertyId];
        require(property.isListed, "Property not listed");

        propertyReviews[_propertyId].push(Review({
            reviewer: msg.sender,
            rating: _rating,
            comment: _comment,
            timestamp: block.timestamp
        }));

        property.totalRating += _rating;
        property.numberOfRatings++;
        hasReviewed[_propertyId][msg.sender] = true;

        emit ReviewAdded(_propertyId, msg.sender, _rating, _comment);
    }

    function getPropertyRating(uint256 _propertyId) public view returns (uint256 averageRating, uint256 numReviews) {
        Property storage property = properties[_propertyId];
        if (property.numberOfRatings == 0) {
            return (0, 0);
        }
        return (property.totalRating / property.numberOfRatings, property.numberOfRatings);
    }

    function getPropertyReviews(uint256 _propertyId) public view returns (Review[] memory) {
        return propertyReviews[_propertyId];
    }

    function getPropertyShareholders(uint256 _propertyId) public view returns (
        address[] memory shareholders,
        uint256[] memory shareAmounts
    ) {
        address[] storage _shareholders = propertyShareholderList[_propertyId];
        shareholders = new address[](_shareholders.length);
        shareAmounts = new uint256[](_shareholders.length);

        for (uint256 i = 0; i < _shareholders.length; i++) {
            shareholders[i] = _shareholders[i];
            shareAmounts[i] = propertyShares[_propertyId][_shareholders[i]];
        }

        return (shareholders, shareAmounts);
    }

    function isShareHolder(uint256 _propertyId, address _address) public view returns (bool) {
        return isPropertyShareholder[_propertyId][_address];
    }

    function rentProperty(uint256 _propertyId, uint256 _years) 
        public 
        payable 
        validPropertyId(_propertyId)
        isNotRented(_propertyId)
        isValidRentalDuration(_years)
    {
        require(registeredUsers[msg.sender], "User not registered");
        
        Property storage property = properties[_propertyId];
        require(property.isListed, "Property not listed");
        require(property.availableShares == 0, "All shares must be sold before renting");

        // Calculate yearly rent (50% of total value)
        uint256 yearlyRent = property.totalValue / 2;
        uint256 totalRent = yearlyRent * _years;
        require(msg.value >= totalRent, "Insufficient payment for rent");

        // Set up rental
        uint256 startDate = block.timestamp;
        uint256 endDate = startDate + (_years * 365 days);
        
        propertyRentals[_propertyId] = Rental({
            tenant: msg.sender,
            startDate: startDate,
            endDate: endDate,
            yearlyRent: yearlyRent,
            isActive: true
        });

        property.isRented = true;
        property.yearlyRentalFee = yearlyRent;

        // Add to user's rental list
        userRentals[msg.sender].push(_propertyId);

        // Distribute first year's rent immediately
        distributeRentalPayment(_propertyId);

        emit PropertyRented(_propertyId, msg.sender, startDate, endDate, yearlyRent);
    }

    function distributeRentalPayment(uint256 _propertyId) 
        public 
        validPropertyId(_propertyId)
    {
        Property storage property = properties[_propertyId];
        Rental storage rental = propertyRentals[_propertyId];
        require(rental.isActive, "No active rental for this property");

        uint256 totalShares = property.totalShares;
        uint256 yearlyRent = rental.yearlyRent;
        
        address[] storage shareholders = propertyShareholderList[_propertyId];
        
        for (uint256 i = 0; i < shareholders.length; i++) {
            address shareholder = shareholders[i];
            uint256 shares = propertyShares[_propertyId][shareholder];
            
            if (shares > 0) {
                uint256 payment = (yearlyRent * shares) / totalShares;
                (bool success, ) = payable(shareholder).call{value: payment}("");
                require(success, "Failed to send rental payment");

                emit RentalPaymentDistributed(
                    _propertyId,
                    shareholder,
                    payment,
                    block.timestamp
                );
            }
        }
    }

    function getUserRentals(address _user) public view returns (
        uint256[] memory propertyIds,
        Rental[] memory rentals
    ) {
        uint256[] storage userPropertyIds = userRentals[_user];
        propertyIds = new uint256[](userPropertyIds.length);
        rentals = new Rental[](userPropertyIds.length);

        for (uint256 i = 0; i < userPropertyIds.length; i++) {
            propertyIds[i] = userPropertyIds[i];
            rentals[i] = propertyRentals[userPropertyIds[i]];
        }

        return (propertyIds, rentals);
    }

    function isPropertyRented(uint256 _propertyId) public view returns (bool) {
        return properties[_propertyId].isRented;
    }

    function getRentalDetails(uint256 _propertyId) public view returns (
        address tenant,
        uint256 startDate,
        uint256 endDate,
        uint256 yearlyRent,
        bool isActive
    ) {
        Rental storage rental = propertyRentals[_propertyId];
        return (
            rental.tenant,
            rental.startDate,
            rental.endDate,
            rental.yearlyRent,
            rental.isActive
        );
    }
} 