// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./RealEstate.sol";

contract RealEstateRental is RealEstate {
    struct Rental {
        address tenant;
        uint256 startDate;
        uint256 endDate;
        uint256 yearlyRent;
        bool isActive;
    }

    mapping(uint256 => Rental) public propertyRentals;
    mapping(address => uint256[]) public userRentals;

    event PropertyRented(uint256 indexed propertyId, address indexed tenant, uint256 startDate, uint256 endDate, uint256 yearlyRent);
    event RentalPaymentDistributed(uint256 indexed propertyId, uint256 amount);

    function rentProperty(uint256 _propertyId, uint256 _durationInYears) external payable {
        require(_durationInYears >= 1 && _durationInYears <= 10, "Rental duration must be between 1 and 10 years");
        require(isUserRegistered[msg.sender], "User must be registered");
        require(properties[_propertyId].isListed, "Property must be listed");
        require(!propertyRentals[_propertyId].isActive, "Property is already rented");

        Property storage property = properties[_propertyId];
        uint256 yearlyRent = (property.price * 50) / 100;  // 50% of property value per year
        uint256 totalRentAmount = yearlyRent * _durationInYears;
        
        require(msg.value >= totalRentAmount, "Insufficient rent payment");

        Rental memory newRental = Rental({
            tenant: msg.sender,
            startDate: block.timestamp,
            endDate: block.timestamp + (_durationInYears * 365 days),
            yearlyRent: yearlyRent,
            isActive: true
        });

        propertyRentals[_propertyId] = newRental;
        userRentals[msg.sender].push(_propertyId);

        emit PropertyRented(_propertyId, msg.sender, newRental.startDate, newRental.endDate, yearlyRent);
        
        // Distribute first year's rent immediately
        distributeRentalPayment(_propertyId);
    }

    function distributeRentalPayment(uint256 _propertyId) public {
        Rental storage rental = propertyRentals[_propertyId];
        require(rental.isActive, "No active rental for this property");

        uint256 totalShares = properties[_propertyId].totalShares;
        uint256 yearlyRent = rental.yearlyRent;

        for (uint256 i = 0; i < shareholders[_propertyId].length; i++) {
            address shareholder = shareholders[_propertyId][i];
            uint256 shares = getShareholderShares(_propertyId, shareholder);
            
            if (shares > 0) {
                uint256 payment = (yearlyRent * shares) / totalShares;
                payable(shareholder).transfer(payment);
            }
        }

        emit RentalPaymentDistributed(_propertyId, yearlyRent);
    }

    function getUserRentals(address _user) external view returns (uint256[] memory) {
        return userRentals[_user];
    }

    function getRentalDetails(uint256 _propertyId) external view returns (
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