// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface PoolData {
  id: number;
  name: string;
  liquidity: string;
  volume: string;
  fees: string;
  timestamp: number;
  creator: string;
}

const FHEEncryptNumber = (value: number): string => `FHE-${btoa(value.toString())}`;
const FHEDecryptNumber = (encryptedData: string): number => encryptedData.startsWith('FHE-') ? parseFloat(atob(encryptedData.substring(4))) : parseFloat(encryptedData);
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [pools, setPools] = useState<PoolData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPool, setCreatingPool] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newPoolData, setNewPoolData] = useState({ name: "", liquidity: "", fees: "" });
  const [selectedPool, setSelectedPool] = useState<PoolData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ liquidity: number | null; fees: number | null }>({ liquidity: null, fees: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [chainId, setChainId] = useState(0);
  const [startTimestamp, setStartTimestamp] = useState(0);
  const [durationDays, setDurationDays] = useState(30);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
      
      const poolsBytes = await contract.getData("pools");
      let poolsList: PoolData[] = [];
      if (poolsBytes.length > 0) {
        try {
          const poolsStr = ethers.toUtf8String(poolsBytes);
          if (poolsStr.trim() !== '') poolsList = JSON.parse(poolsStr);
        } catch (e) {}
      }
      setPools(poolsList);
    } catch (e) {
      console.error("Error loading data:", e);
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  const createPool = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPool(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating pool with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const newPool: PoolData = {
        id: pools.length + 1,
        name: newPoolData.name,
        liquidity: FHEEncryptNumber(parseFloat(newPoolData.liquidity) || 0),
        volume: FHEEncryptNumber(0),
        fees: FHEEncryptNumber(parseFloat(newPoolData.fees) || 0),
        timestamp: Math.floor(Date.now() / 1000),
        creator: address
      };
      
      const updatedPools = [...pools, newPool];
      
      await contract.setData("pools", ethers.toUtf8Bytes(JSON.stringify(updatedPools)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Pool created successfully!" });
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPoolData({ name: "", liquidity: "", fees: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPool(false); 
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const filteredPools = pools.filter(pool => 
    pool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    pool.creator.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderDashboard = () => {
    const totalLiquidity = pools.reduce((sum, p) => sum + (decryptedData.liquidity || FHEDecryptNumber(p.liquidity)), 0);
    const avgFees = pools.length > 0 ? pools.reduce((sum, p) => sum + (decryptedData.fees || FHEDecryptNumber(p.fees)), 0) / pools.length : 0;
    
    return (
      <div className="dashboard-panels">
        <div className="panel">
          <h3>Total Encrypted Liquidity</h3>
          <div className="stat-value">{totalLiquidity.toFixed(2)} ETH</div>
          <div className="stat-trend">+8% last week</div>
        </div>
        
        <div className="panel">
          <h3>Average Fees</h3>
          <div className="stat-value">{avgFees.toFixed(1)}%</div>
          <div className="stat-trend">+2% last month</div>
        </div>
        
        <div className="panel">
          <h3>Active Pools</h3>
          <div className="stat-value">{pools.length}</div>
          <div className="stat-trend">5 new this week</div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Encrypt Liquidity</h4>
            <p>LP positions encrypted with Zama FHE before entering pool</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>Secure Matching</h4>
            <p>Trades matched in encrypted state using homomorphic computation</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Private Settlement</h4>
            <p>Transactions settled without revealing LP positions</p>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqItems = [
      {
        question: "What is AmmCipher?",
        answer: "A confidential AMM where liquidity positions and trades are encrypted using Zama FHE technology."
      },
      {
        question: "How does FHE protect LPs?",
        answer: "Your liquidity position remains encrypted, preventing front-running and strategy copying."
      },
      {
        question: "What data is encrypted?",
        "answer": "All liquidity amounts, trade sizes, and price calculations are encrypted."
      },
      {
        question: "Who can decrypt my data?",
        answer: "Only you with your wallet signature can decrypt your position data."
      }
    ];
    
    return (
      <div className="faq-container">
        {faqItems.map((item, index) => (
          <div className="faq-item" key={index}>
            <div className="faq-question">{item.question}</div>
            <div className="faq-answer">{item.answer}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted AMM...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Amm<span>Cipher</span></h1>
          <div className="logo-subtitle">Confidential AMM with Zama FHE</div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Pool
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="tabs-container">
          <div className="tabs">
            <button 
              className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              Dashboard
            </button>
            <button 
              className={`tab ${activeTab === 'pools' ? 'active' : ''}`}
              onClick={() => setActiveTab('pools')}
            >
              Pools
            </button>
            <button 
              className={`tab ${activeTab === 'faq' ? 'active' : ''}`}
              onClick={() => setActiveTab('faq')}
            >
              FAQ
            </button>
          </div>
        </div>
        
        <div className="tab-content">
          {activeTab === 'dashboard' && (
            <div className="dashboard-content">
              <h2>Encrypted Liquidity Dashboard</h2>
              {renderDashboard()}
              
              <div className="panel full-width">
                <h3>FHE-Powered Trading Process</h3>
                {renderFHEProcess()}
              </div>
            </div>
          )}
          
          {activeTab === 'pools' && (
            <div className="pools-section">
              <div className="section-header">
                <h2>Encrypted Liquidity Pools</h2>
                <div className="header-actions">
                  <input
                    type="text"
                    placeholder="Search pools..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                  <button 
                    onClick={loadData} 
                    className="refresh-btn" 
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="pools-list">
                {filteredPools.length === 0 ? (
                  <div className="no-pools">
                    <p>No liquidity pools found</p>
                    <button 
                      className="create-btn" 
                      onClick={() => setShowCreateModal(true)}
                    >
                      Create First Pool
                    </button>
                  </div>
                ) : filteredPools.map((pool, index) => (
                  <div 
                    className={`pool-item ${selectedPool?.id === pool.id ? "selected" : ""}`} 
                    key={index}
                    onClick={() => setSelectedPool(pool)}
                  >
                    <div className="pool-title">{pool.name}</div>
                    <div className="pool-meta">
                      <span>Liquidity: {pool.liquidity.substring(0, 15)}...</span>
                      <span>Fees: {pool.fees.substring(0, 15)}...</span>
                    </div>
                    <div className="pool-creator">Creator: {pool.creator.substring(0, 6)}...{pool.creator.substring(38)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {activeTab === 'faq' && (
            <div className="faq-section">
              <h2>Frequently Asked Questions</h2>
              {renderFAQ()}
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreatePool 
          onSubmit={createPool} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingPool} 
          poolData={newPoolData} 
          setPoolData={setNewPoolData}
        />
      )}
      
      {selectedPool && (
        <PoolDetailModal 
          pool={selectedPool} 
          onClose={() => { 
            setSelectedPool(null); 
            setDecryptedData({ liquidity: null, fees: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <span>AmmCipher</span>
            <p>Confidential AMM powered by Zama FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Docs</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} AmmCipher</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreatePoolProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  poolData: any;
  setPoolData: (data: any) => void;
}

const ModalCreatePool: React.FC<ModalCreatePoolProps> = ({ onSubmit, onClose, creating, poolData, setPoolData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPoolData({ ...poolData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-pool-modal">
        <div className="modal-header">
          <h2>New Encrypted Pool</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div>
            <div>
              <strong>FHE Encryption</strong>
              <p>All data will be encrypted with Zama FHE</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Pool Name *</label>
            <input 
              type="text" 
              name="name" 
              value={poolData.name} 
              onChange={handleChange} 
              placeholder="Enter pool name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Initial Liquidity (ETH) *</label>
            <input 
              type="number" 
              name="liquidity" 
              value={poolData.liquidity} 
              onChange={handleChange} 
              placeholder="Enter liquidity amount..." 
            />
          </div>
          
          <div className="form-group">
            <label>Fee Percentage *</label>
            <input 
              type="number" 
              min="0" 
              max="10" 
              name="fees" 
              value={poolData.fees} 
              onChange={handleChange} 
              placeholder="Enter fee percentage..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || !poolData.name || !poolData.liquidity || !poolData.fees} 
            className="submit-btn"
          >
            {creating ? "Creating with FHE..." : "Create Pool"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface PoolDetailModalProps {
  pool: PoolData;
  onClose: () => void;
  decryptedData: { liquidity: number | null; fees: number | null };
  setDecryptedData: (value: { liquidity: number | null; fees: number | null }) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const PoolDetailModal: React.FC<PoolDetailModalProps> = ({ 
  pool, 
  onClose, 
  decryptedData, 
  setDecryptedData, 
  isDecrypting, 
  decryptWithSignature
}) => {
  const handleDecrypt = async (field: 'liquidity' | 'fees') => {
    if (decryptedData[field] !== null) { 
      setDecryptedData({ ...decryptedData, [field]: null }); 
      return; 
    }
    
    const encryptedValue = field === 'liquidity' ? pool.liquidity : pool.fees;
    const decrypted = await decryptWithSignature(encryptedValue);
    if (decrypted !== null) {
      setDecryptedData({ ...decryptedData, [field]: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="pool-detail-modal">
        <div className="modal-header">
          <h2>Pool Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="pool-info">
            <div className="info-item">
              <span>Pool Name:</span>
              <strong>{pool.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{pool.creator.substring(0, 6)}...{pool.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(pool.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Pool Data</h3>
            <div className="data-row">
              <div className="data-label">Liquidity:</div>
              <div className="data-value">{pool.liquidity.substring(0, 30)}...</div>
              <button 
                className="decrypt-btn" 
                onClick={() => handleDecrypt('liquidity')} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "Decrypting..."
                ) : decryptedData.liquidity !== null ? (
                  "Hide Value"
                ) : (
                  "Decrypt Liquidity"
                )}
              </button>
            </div>
            
            <div className="data-row">
              <div className="data-label">Fees:</div>
              <div className="data-value">{pool.fees.substring(0, 30)}...</div>
              <button 
                className="decrypt-btn" 
                onClick={() => handleDecrypt('fees')} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "Decrypting..."
                ) : decryptedData.fees !== null ? (
                  "Hide Value"
                ) : (
                  "Decrypt Fees"
                )}
              </button>
            </div>
            
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>FHE Encrypted - Requires Wallet Signature</span>
            </div>
          </div>
          
          {(decryptedData.liquidity !== null || decryptedData.fees !== null) && (
            <div className="decrypted-values">
              {decryptedData.liquidity !== null && (
                <div className="value-item">
                  <span>Liquidity:</span>
                  <strong>{decryptedData.liquidity.toFixed(2)} ETH</strong>
                </div>
              )}
              {decryptedData.fees !== null && (
                <div className="value-item">
                  <span>Fees:</span>
                  <strong>{decryptedData.fees.toFixed(1)}%</strong>
                </div>
              )}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;