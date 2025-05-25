const express = require('express');
const app = express();
const path = require('path');

app.use(express.static('public'));

app.use('/contracts', express.static(path.join(__dirname, 'build/contracts')));

app.get('/RealEstate.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'build/contracts/RealEstate.json'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

const port = 3000;
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 