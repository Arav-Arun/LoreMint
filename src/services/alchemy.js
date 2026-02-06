/**
 * Alchemy Service
 * Used to fetch NFT data from the backend proxy
 */

// Helper to strip IPFS prefix
const stripIpfsPrefix = (cidOrUrl) => {
  return cidOrUrl.replace(/^ipfs:\/\/(ipfs\/)?/, "");
};

/**
 * Extract best available image URL from NFT data
 * Prioritizes cached URLs and tries to handle IPFS/Gateway logic
 * @param {Object} nft - The raw NFT object from Alchemy
 * @returns {string|null} The resolved image URL or null
 */
const extractImageUrl = (nft) => {
  // Try multiple sources for image in order of preference
  const sources = [
    nft.image?.cachedUrl,
    nft.image?.originalUrl,
    nft.image?.thumbnailUrl,
    nft.image?.pngUrl,
    nft.raw?.metadata?.image,
    nft.media?.[0]?.gateway,
    nft.media?.[0]?.raw,
  ];

  for (const src of sources) {
    if (src && typeof src === "string") {
      // 1. Handle "ipfs://" protocol
      if (src.startsWith("ipfs://")) {
        const cidPath = stripIpfsPrefix(src);
        // Use Cloudflare or Alchemy gateway (often faster/more reliable than dweb.link)
        return `https://ipfs.io/ipfs/${cidPath}`;
      }

      // 2. Handle HTTP/HTTPS URLs (including gateways)
      if (src.startsWith("http")) {
        return src;
      }

      // 3. Handle data URIs
      if (src.startsWith("data:")) {
        return src;
      }
    }
  }

  return null;
};

/**
 * Extract low-res thumbnail if available
 * @param {Object} nft - The raw NFT object
 * @returns {string|null} Thumbnail URL or falls back to main image
 */
const extractThumbnailUrl = (nft) => {
  const sources = [
    nft.image?.thumbnailUrl,
    nft.image?.pngUrl,
    nft.image?.cachedUrl,
  ];

  for (const src of sources) {
    if (src && typeof src === "string") {
      if (src.startsWith("ipfs://")) {
        return `https://ipfs.io/ipfs/${stripIpfsPrefix(src)}`;
      }
      if (src.startsWith("http")) return src;
    }
  }
  return extractImageUrl(nft); // Fallback to main image logic
};

/**
 * Fetch all NFTs owned by a wallet address
 * @param {string} address - Wallet address
 * @param {number} chainId - Chain ID (default 1)
 * @returns {Promise<Array>} Array of NFT objects
 */
export const getNFTsForOwner = async (address, chainId = 1) => {
  try {
    const response = await fetch("/api/alchemy/nfts-for-owner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, chainId }),
    });
    const nfts = await response.json();

    if (!nfts.ownedNfts) return [];

    // Transform Alchemy response to our format
    return nfts.ownedNfts.map((nft) => ({
      id: `${nft.contract.address}-${nft.tokenId}`,
      contract: nft.contract.address,
      tokenId: nft.tokenId,
      name:
        nft.name ||
        nft.title ||
        `${nft.contract.name || "Unknown"} #${nft.tokenId}`,
      collection: nft.contract.name || "Unknown Collection",
      image: extractImageUrl(nft),
      thumbnail: extractThumbnailUrl(nft),
      description: nft.description,
      traits: (nft.raw?.metadata?.attributes || []).map((attr) => ({
        trait_type: attr.trait_type || "Property",
        value: attr.value,
        rarity: null,
      })),
      rawMetadata: nft.raw?.metadata,
      tokenType: nft.tokenType,
    }));
  } catch (error) {
    console.error("Error fetching NFTs for owner:", error);
    throw new Error("Failed to fetch NFTs from wallet");
  }
};

/**
 * Get basic metadata for grid view (Lightweight)
 * Skips heavy rarity/floor price calculations
 */
export const getBasicNFTMetadata = async (contractAddress, tokenId) => {
  try {
    const response = await fetch("/api/alchemy/nft-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress, tokenId }),
    });
    const nft = await response.json();

    return {
      name:
        nft.name || nft.title || `${nft.contract?.name || "NFT"} #${tokenId}`,
      collection:
        nft.contract?.name || nft.contract?.symbol || "Unknown Collection",
      tokenId: nft.tokenId || tokenId,
      contract: nft.contract?.address || contractAddress,
      image: extractImageUrl(nft),
      thumbnail: extractThumbnailUrl(nft),
      description: nft.description || nft.raw?.metadata?.description || "",
      // No traits/rarity/floor used in grid
    };
  } catch (error) {
    console.error(`Error fetching basic NFT metadata for ${tokenId}:`, error);
    // Return minimal fallback
    return {
      tokenId: tokenId,
      name: `#${tokenId}`,
      collection: "Unknown",
      image: null,
      contract: contractAddress,
    };
  }
};

/**
 * Get detailed metadata for a specific NFT with REAL rarity data
 * @param {string} contractAddress - NFT contract address
 * @param {string} tokenId - Token ID
 * @returns {Promise<Object>} NFT metadata
 */
export const getNFTMetadata = async (contractAddress, tokenId) => {
  try {
    const response = await fetch("/api/alchemy/nft-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress, tokenId }),
    });
    const nft = await response.json();

    // Extract traits/attributes
    const rawTraits =
      nft.raw?.metadata?.attributes || nft.rawMetadata?.attributes || [];

    // Calculate Rarity using Collection Stats
    // For featured collections, we can use cached/hardcoded stats to be instant
    // For others, we'll fetch a sample to estimate
    const collectionStats = await getCollectionStats(contractAddress);

    // Process traits with rarity
    const traits = rawTraits.map((trait) => {
      const traitType = trait.trait_type || trait.name || "Property";
      const value = String(trait.value || "");

      // Calculate rarity if stats exist
      let rarity = null;
      if (
        collectionStats &&
        collectionStats[traitType] &&
        collectionStats[traitType][value]
      ) {
        rarity = collectionStats[traitType][value].percentage;
      }

      return {
        trait_type: traitType,
        value: value,
        rarity: rarity ? parseFloat(rarity.toFixed(2)) : null,
      };
    });

    // Fetch Collection Metadata and Floor Price FIRST (needed for market-aware scoring)
    const cmResponse = await fetch("/api/alchemy/contract-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress }),
    });
    const contractMetadata = await cmResponse.json();

    const floorData = await getFloorPrice(contractAddress);
    const floorPriceETH = floorData.openSea || 0;

    // Calculate Overall Rarity Score using HARMONIC MEAN + MARKET CONTEXT
    // KEY INSIGHT: "rare" traits in a worthless collection are still worthless
    // We use floor price as a proxy for collection value/prestige
    let rawTraitScore = null;
    let rarityScore = null;
    let rarityPercentile = null;
    let hasValidTraitRarity = false;

    if (traits.length > 0) {
      const validTraits = traits.filter(
        (t) => t.rarity !== null && t.rarity > 0,
      );
      if (validTraits.length > 0) {
        hasValidTraitRarity = true;
        // Step 1: Calculate raw trait-based score using harmonic mean
        const harmonicSum = validTraits.reduce(
          (sum, t) => sum + 1 / t.rarity,
          0,
        );
        const harmonicMean = validTraits.length / harmonicSum;
        const logRarity = Math.log10(Math.max(0.1, harmonicMean));
        rawTraitScore = Math.max(0, Math.min(100, 85 - logRarity * 35));
      }
    }

    // Step 2: Only apply market context if we have actual trait rarity data
    if (hasValidTraitRarity && rawTraitScore !== null) {
      let marketMultiplier = 1.0;
      let maxAllowedScore = 100;

      if (floorPriceETH < 0.5) {
        marketMultiplier = 0.45;
        maxAllowedScore = 45;
      } else if (floorPriceETH < 1) {
        marketMultiplier = 0.55;
        maxAllowedScore = 55;
      } else if (floorPriceETH < 3) {
        marketMultiplier = 0.7;
        maxAllowedScore = 70;
      } else if (floorPriceETH < 10) {
        marketMultiplier = 0.85;
        maxAllowedScore = 85;
      }
      // 10+ ETH: Blue chip - no cap, full scoring

      // Apply market weighting and cap
      rarityScore = Math.min(
        maxAllowedScore,
        Math.round(rawTraitScore * marketMultiplier),
      );
      rarityPercentile = rarityScore;
    }

    return {
      name:
        nft.name || nft.title || `${nft.contract?.name || "NFT"} #${tokenId}`,
      collection:
        contractMetadata.name ||
        nft.contract?.name ||
        nft.contract?.symbol ||
        "Unknown Collection",
      tokenId: nft.tokenId || tokenId,
      contract: nft.contract?.address || contractAddress,
      image: extractImageUrl(nft),
      thumbnail: extractThumbnailUrl(nft),
      description: nft.description || nft.raw?.metadata?.description || "",
      traits: traits,
      tokenType: nft.tokenType,
      rawMetadata: nft.raw?.metadata || nft.rawMetadata,
      rarityScore: Math.round(rarityScore),
      rarityPercentile: rarityPercentile,
      floorPrice: floorData.openSea || 0,
      contractMetadata: {
        totalSupply: contractMetadata.totalSupply,
        symbol: contractMetadata.symbol,
        tokenType: contractMetadata.tokenType,
        contractDeployer: contractMetadata.contractDeployer,
        openSeaMetadata: contractMetadata.openSea || {},
        name: contractMetadata.name || contractMetadata.openSea?.collectionName,
        description:
          contractMetadata.openSea?.description ||
          "No collection description available.",
        imageUrl:
          contractMetadata.openSea?.imageUrl ||
          contractMetadata.openSea?.safelistRequestStatus === "verified"
            ? contractMetadata.openSea?.imageUrl
            : null, // Use verified image or fallback
      },
    };
  } catch (error) {
    console.error("Error fetching NFT metadata:", error);
    throw new Error("Failed to fetch NFT metadata");
  }
};

/**
 * Get current owner(s) of an NFT
 * @param {string} contractAddress - NFT contract address
 * @param {string} tokenId - Token ID
 * @returns {Promise<Object>} Owner information
 */
export const getOwnersForNft = async (contractAddress, tokenId) => {
  try {
    const response = await fetch("/api/alchemy/owners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress, tokenId }),
    });
    const ownersResp = await response.json();
    const owners = ownersResp.owners || [];

    if (owners.length === 0) {
      return { owner: null, ownerDisplay: "Unknown" };
    }

    const primaryOwner = owners[0];
    const ensName = await resolveENS(primaryOwner);

    return {
      owner: primaryOwner,
      ownerDisplay: ensName,
      totalOwners: owners.length,
    };
  } catch (error) {
    console.error("Error fetching NFT owners:", error);
    return { owner: null, ownerDisplay: "Unknown" };
  }
};

/**
 * Get Collection Stats (Trait Frequencies)
 * Uses caching and sampling for performance
 */
const collectionStatsCache = {};

export const getCollectionStats = async (contractAddress) => {
  // Return cached if available
  if (collectionStatsCache[contractAddress]) {
    return collectionStatsCache[contractAddress];
  }

  try {
    // Use Alchemy's built-in summary endpoint for accurate abundance data
    const response = await fetch("/api/alchemy/collection-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress }),
    });
    const summary = await response.json();

    // Structure: summary.summary[traitType][value] = count
    const stats = {};
    const totalSupply = summary.totalSupply || 10000; // Fallback if missing

    if (summary.summary) {
      Object.keys(summary.summary).forEach((traitType) => {
        stats[traitType] = {};
        Object.keys(summary.summary[traitType]).forEach((value) => {
          const count = summary.summary[traitType][value];
          stats[traitType][value] = {
            count: count,
            percentage: (count / totalSupply) * 100,
          };
        });
      });
    }

    // Cache the result
    collectionStatsCache[contractAddress] = stats;
    return stats;
  } catch (error) {
    console.error("Error generating collection stats:", error);
    return null;
  }
};

/**
 * Get collection floor price
 * @param {string} contractAddress - Collection contract address
 * @returns {Promise<Object>} Floor price data
 */
export const getFloorPrice = async (contractAddress) => {
  try {
    const response = await fetch("/api/alchemy/floor-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress }),
    });
    const floorPrice = await response.json();

    return {
      openSea: floorPrice.openSea?.floorPrice || 0,
      looksRare: floorPrice.looksRare?.floorPrice || 0,
      priceCurrency: floorPrice.openSea?.priceCurrency || "ETH",
    };
  } catch (error) {
    console.error("Error fetching floor price:", error);
    return {
      openSea: 0,
      looksRare: 0,
      priceCurrency: "ETH",
    };
  }
};

/**
 * Get transfer history for an NFT using asset transfers
 * @param {string} contractAddress - NFT contract address
 * @param {string} tokenId - Token ID
 * @returns {Promise<Array>} Transfer history
 */
export const getTransferHistory = async (contractAddress, tokenId) => {
  try {
    // Use getAssetTransfers with the proper parameters
    const response = await fetch("/api/alchemy/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress, tokenId }),
    });
    const transfersResp = await response.json();

    // Filter for this specific token ID and format
    // backend response has .transfers
    const tokenTransfers = transfersResp.transfers
      .filter((t) => {
        // token IDs can be in different formats
        const transferTokenId =
          t.erc721TokenId || t.erc1155Metadata?.[0]?.tokenId;
        if (!transferTokenId) return false;
        // Compare as numbers to handle hex vs decimal
        return BigInt(transferTokenId) === BigInt(tokenId);
      })
      .slice(0, 10) // Limit to last 10 transfers
      .map((transfer) => ({
        from: transfer.from,
        to: transfer.to,
        blockNum: transfer.blockNum,
        hash: transfer.hash,
        timestamp: transfer.metadata?.blockTimestamp,
      }));

    return tokenTransfers;
  } catch (error) {
    console.error("Error fetching transfer history:", error);
    return [];
  }
};

/**
 * Get all NFTs in a collection with metadata
 * @param {string} contractAddress - Collection contract address
 * @returns {Promise<Array>} Collection NFTs
 */
export const getCollectionNFTs = async (contractAddress) => {
  try {
    const response = await fetch("/api/alchemy/collection-nfts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress }),
    });
    const nfts = await response.json();

    return nfts.nfts.map((nft) => ({
      tokenId: nft.tokenId,
      traits: nft.raw?.metadata?.attributes || [],
    }));
  } catch (error) {
    console.error("Error fetching collection NFTs:", error);
    return [];
  }
};

/**
 * Resolve ENS name for an address
 * @param {string} address - Ethereum address
 * @returns {Promise<string>} ENS name or shortened address
 */
export const resolveENS = async (address) => {
  try {
    const response = await fetch("/api/alchemy/resolve-ens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const { name: ensName } = await response.json();

    if (ensName) return ensName;

    return `${address.substring(0, 6)}...${address.substring(
      address.length - 4,
    )}`;
  } catch {
    return `${address.substring(0, 6)}...${address.substring(
      address.length - 4,
    )}`;
  }
};

/**
 * Get NFT sale history
 * @param {string} contractAddress - NFT contract address
 * @param {string} tokenId - Token ID
 * @returns {Promise<Array>} Sale history with prices and marketplaces
 */
export const getNftSales = async (contractAddress, tokenId) => {
  try {
    const response = await fetch("/api/alchemy/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress, tokenId }),
    });
    const salesResp = await response.json();

    return salesResp.nftSales.map((sale) => {
      // Price can be in different fields depending on the marketplace
      let price = null;
      if (sale.taker?.amount) {
        price = parseFloat(sale.taker.amount) / 1e18;
      } else if (sale.sellerFee?.amount) {
        price = parseFloat(sale.sellerFee.amount) / 1e18;
      } else if (sale.protocolFee?.amount) {
        price = parseFloat(sale.protocolFee.amount) / 1e18;
      }

      return {
        marketplace: sale.marketplace || "Unknown",
        price,
        priceSymbol: sale.taker?.symbol || sale.sellerFee?.symbol || "ETH",
        buyer: sale.buyerAddress,
        seller: sale.sellerAddress,
        blockNumber: sale.blockNumber,
        transactionHash: sale.transactionHash,
        timestamp: sale.bundleIndex, // bundleIndex often used as timestamp proxy
      };
    });
  } catch (error) {
    console.error("Error fetching NFT sales:", error);
    return [];
  }
};

/**
 * Compute rarity for an NFT using Alchemy's official algorithm
 * @param {string} contractAddress - NFT contract address
 * @param {string} tokenId - Token ID
 * @returns {Promise<Object>} Rarity data with score and rank
 */
export const computeNftRarity = async (contractAddress, tokenId) => {
  try {
    const response = await fetch("/api/alchemy/compute-rarity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress, tokenId }),
    });
    const rarityData = await response.json();

    // Response contains trait rarity info
    // backend returns "rarity" which IS an array in alchemy sdk
    return {
      traits: rarityData.map((trait) => ({
        traitType: trait.traitType,
        value: trait.value,
        prevalence: trait.prevalence, // Percentage of collection with this trait
      })),
      // Calculate overall rarity score from trait prevalences
      overallScore:
        rarityData.length > 0
          ? Math.round(
              100 -
                rarityData.reduce((sum, t) => sum + (t.prevalence || 50), 0) /
                  rarityData.length,
            )
          : null,
    };
  } catch (error) {
    console.error("Error computing rarity:", error);
    return null;
  }
};

/**
 * Check if a contract is flagged as spam
 * Uses the spam classification from NFT metadata
 * @param {string} contractAddress - Contract address to check
 * @returns {Promise<Object>} Spam status and classification
 */
export const checkSpamStatus = async (contractAddress) => {
  try {
    // Get contract metadata which includes spam classification
    const response = await fetch("/api/alchemy/contract-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress }),
    });
    const contractMeta = await response.json();

    return {
      isSpam: contractMeta.isSpam || false,
      spamClassifications: contractMeta.spamClassifications || [],
      // Common classifications: "OwnedByMostHoneyPots", "Erc721TooManyOwners", etc.
    };
  } catch (error) {
    console.error("Error checking spam status:", error);
    return { isSpam: false, spamClassifications: [] };
  }
};

// Remove default export as it was the alchemy instance
export default {};
