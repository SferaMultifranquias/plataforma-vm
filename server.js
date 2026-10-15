require('dotenv').config();

const app = require('./src/server/app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\nSfera VM rodando em http://localhost:${PORT}`);
  console.log('Frontend e configuracao publica do Supabase disponiveis.\n');
});
