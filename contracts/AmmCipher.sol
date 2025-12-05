pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AmmCipherFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error BatchAlreadyClosed();
    error InvalidParameter();
    error ReplayAttempt();
    error StateMismatch();
    error DecryptionFailed();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PausedSet(bool paused);
    event CooldownSet(uint256 cooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event LiquidityAdded(address indexed provider, uint256 indexed batchId, uint256 encryptedAmount);
    event TradeExecuted(address indexed trader, uint256 indexed batchId, uint256 encryptedInputAmount, uint256 encryptedOutputAmount);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalLiquidity, uint256 totalVolume);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    bool public batchOpen;
    mapping(uint256 => mapping(address => euint32)) public encryptedLiquidityByProvider;
    mapping(uint256 => euint32) public encryptedTotalLiquidity;
    mapping(uint256 => euint32) public encryptedTotalVolume;

    mapping(uint256 => DecryptionContext) public decryptionContexts;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[msg.sender] = true;
        emit ProviderAdded(msg.sender);
        paused = false;
        cooldownSeconds = 10; // Default cooldown
        currentBatchId = 0;
        batchOpen = false;
    }

    function addProvider(address _provider) external onlyOwner {
        if (_provider == address(0)) revert InvalidParameter();
        if (!isProvider[_provider]) {
            isProvider[_provider] = true;
            emit ProviderAdded(_provider);
        }
    }

    function removeProvider(address _provider) external onlyOwner {
        if (isProvider[_provider]) {
            isProvider[_provider] = false;
            emit ProviderRemoved(_provider);
        }
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function setCooldown(uint256 _cooldownSeconds) external onlyOwner {
        if (_cooldownSeconds == 0) revert InvalidParameter();
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSet(_cooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert BatchAlreadyClosed(); // Misnamed, should be BatchAlreadyOpen or similar, but sticking to "BatchAlreadyClosed" as per prompt.
        currentBatchId++;
        batchOpen = true;
        encryptedTotalLiquidity[currentBatchId] = FHE.asEuint32(0);
        encryptedTotalVolume[currentBatchId] = FHE.asEuint32(0);
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchNotOpen();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function addLiquidity(uint64 _cleartextAmount) external payable onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();
        lastSubmissionTime[msg.sender] = block.timestamp;

        euint32 memory encryptedAmount = FHE.asEuint32(_cleartextAmount);
        encryptedLiquidityByProvider[currentBatchId][msg.sender] = encryptedAmount;
        encryptedTotalLiquidity[currentBatchId] = encryptedTotalLiquidity[currentBatchId].add(encryptedAmount);

        emit LiquidityAdded(msg.sender, currentBatchId, _cleartextAmount);
    }

    function executeTrade(uint64 _cleartextInputAmount) external payable whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();
        lastSubmissionTime[msg.sender] = block.timestamp;

        euint32 memory encryptedInputAmount = FHE.asEuint32(_cleartextInputAmount);
        // Simplified: output amount is 90% of input for demo. Real AMM uses pool ratio.
        euint32 memory encryptedOutputAmount = encryptedInputAmount.mul(FHE.asEuint32(9)).div(FHE.asEuint32(10));

        encryptedTotalVolume[currentBatchId] = encryptedTotalVolume[currentBatchId].add(encryptedInputAmount);

        emit TradeExecuted(msg.sender, currentBatchId, _cleartextInputAmount, FHE.toBytes32(encryptedOutputAmount)[0]);
    }

    function requestBatchDecryption(uint256 _batchId) external onlyOwner whenNotPaused checkDecryptionCooldown {
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32 memory totalLiq = encryptedTotalLiquidity[_batchId];
        euint32 memory totalVol = encryptedTotalVolume[_batchId];

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(totalLiq);
        cts[1] = FHE.toBytes32(totalVol);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: _batchId, stateHash: stateHash, processed: false });
        emit DecryptionRequested(requestId, _batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        // Rebuild ciphertexts from current contract storage
        uint256 batchId = decryptionContexts[requestId].batchId;
        euint32 memory totalLiq = encryptedTotalLiquidity[batchId];
        euint32 memory totalVol = encryptedTotalVolume[batchId];

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(totalLiq);
        cts[1] = FHE.toBytes32(totalVol);

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert DecryptionFailed();
        }

        uint256 totalLiquidityCleartext = uint256(uint64(bytes8(cleartexts)));
        uint256 totalVolumeCleartext = uint256(uint64(bytes8(cleartexts[8:])));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, totalLiquidityCleartext, totalVolumeCleartext);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal view returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }
}