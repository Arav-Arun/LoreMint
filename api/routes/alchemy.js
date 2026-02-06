/* global process */
import express from "express";
import { Alchemy, Network } from "alchemy-sdk";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// Initialize Alchemy SDK with backend key
const getApiKey = () => {
  return process.env.ALCHEMY_API_KEY || process.env.VITE_ALCHEMY_API_KEY;
};

const configMainnet = {
  apiKey: getApiKey(),
  network: Network.ETH_MAINNET,
};

const configSepolia = {
  apiKey: getApiKey(),
  network: Network.ETH_SEPOLIA,
};

const alchemyMainnet = new Alchemy(configMainnet);
const alchemySepolia = new Alchemy(configSepolia);

const getClient = (chainId) => {
  return Number(chainId) === 11155111 ? alchemySepolia : alchemyMainnet;
};

// --- ROUTES ---

// Get NFTs for Owner
router.post("/nfts-for-owner", async (req, res) => {
  try {
    const { address, chainId } = req.body;
    if (!address) return res.status(400).json({ error: "Address required" });

    const client = getClient(chainId);
    const nfts = await client.nft.getNftsForOwner(address, {
      excludeFilters: ["SPAM"],
      omitMetadata: false,
    });
    res.json(nfts);
  } catch (error) {
    console.error("Error in /nfts-for-owner:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get NFT Metadata (Basic & Full)
router.post("/nft-metadata", async (req, res) => {
  try {
    const { contractAddress, tokenId, chainId } = req.body;
    if (!contractAddress || !tokenId)
      return res.status(400).json({ error: "Contract and Token ID required" });

    const client = getClient(chainId);
    const nft = await client.nft.getNftMetadata(contractAddress, tokenId, {});
    res.json(nft);
  } catch (error) {
    console.error("Error in /nft-metadata:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get Contract Metadata
router.post("/contract-metadata", async (req, res) => {
  try {
    const { contractAddress, chainId } = req.body;
    const client = getClient(chainId);
    const metadata = await client.nft.getContractMetadata(contractAddress);
    res.json(metadata);
  } catch (error) {
    console.error("Error in /contract-metadata:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get Collection Attribute Summary (Stats)
router.post("/collection-stats", async (req, res) => {
  try {
    const { contractAddress, chainId } = req.body;
    const client = getClient(chainId);
    const stats = await client.nft.summarizeNftAttributes(contractAddress);
    res.json(stats);
  } catch (error) {
    console.error("Error in /collection-stats:", error);
    // Return null/empty if it fails, or error
    res.status(500).json({ error: error.message });
  }
});

// Get Floor Price
router.post("/floor-price", async (req, res) => {
  try {
    const { contractAddress, chainId } = req.body;
    const client = getClient(chainId);
    const floor = await client.nft.getFloorPrice(contractAddress);
    res.json(floor);
  } catch (error) {
    console.error("Error in /floor-price:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get Owners
router.post("/owners", async (req, res) => {
  try {
    const { contractAddress, tokenId, chainId } = req.body;
    const client = getClient(chainId);
    const owners = await client.nft.getOwnersForNft(contractAddress, tokenId);
    res.json(owners);
  } catch (error) {
    console.error("Error in /owners:", error);
    res.status(500).json({ error: error.message });
  }
});

// Resolve ENS
router.post("/resolve-ens", async (req, res) => {
  try {
    const { address, chainId } = req.body;
    const client = getClient(chainId);
    const name = await client.core.lookupAddress(address);
    res.json({ name });
  } catch (error) {
    // ENS lookup failure is common, just return null
    res.json({ name: null });
  }
});

// Get NFT Sales
router.post("/sales", async (req, res) => {
  try {
    const { contractAddress, tokenId, chainId } = req.body;
    const client = getClient(chainId);
    const sales = await client.nft.getNftSales({
      contractAddress,
      tokenId,
      limit: 10,
    });
    res.json(sales);
  } catch (error) {
    console.error("Error in /sales:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get Asset Transfers (Transfer History)
router.post("/transfers", async (req, res) => {
  try {
    const { contractAddress, chainId } = req.body; // Token ID filtering happens in service, or we can do it here if we pass it
    // The original code requests transfers for the *contract* and filters by tokenID in JS.
    // We'll mimic that behavior to avoid changing logic too much.

    const client = getClient(chainId);
    const response = await client.core.getAssetTransfers({
      fromBlock: "0x0",
      toBlock: "latest",
      contractAddresses: [contractAddress],
      category: ["erc721", "erc1155"],
      withMetadata: true,
      excludeZeroValue: false,
    });
    res.json(response);
  } catch (error) {
    console.error("Error in /transfers:", error);
    res.status(500).json({ error: error.message });
  }
});

// Compute Rarity
router.post("/compute-rarity", async (req, res) => {
  try {
    const { contractAddress, tokenId, chainId } = req.body;
    const client = getClient(chainId);
    const rarity = await client.nft.computeRarity(contractAddress, tokenId);
    res.json(rarity);
  } catch (error) {
    console.error("Error in /compute-rarity:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get Collection NFTs (for collection view)
router.post("/collection-nfts", async (req, res) => {
  try {
    const { contractAddress, chainId } = req.body;
    const client = getClient(chainId);
    const nfts = await client.nft.getNftsForContract(contractAddress, {
      omitMetadata: false,
      limit: 100,
    });
    res.json(nfts);
  } catch (error) {
    console.error("Error in /collection-nfts:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
