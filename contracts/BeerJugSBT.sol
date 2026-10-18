// SPDX-License-Identifier: UNLICENSED
// Copyright (C) 2026 Kawade502
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// ERC-5192（譲渡できない NFT）の決まった形。
interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

/**
 * ビールジョッキ（https://kawade502.github.io/beer-jug/）で、ビールを飲み干した杯数の記念 SBT。
 *
 *   種類 1 = 乾杯（2杯）、2 = 常連さん（5杯）、3 = 名誉店主（10杯）
 *
 * アプリは申請（受取アドレス）を集めるだけで、発行は運営者が後日、手作業で mint する。
 * 譲渡も承認もできない。持ち主は自分の分を burn（消す）できる。
 * メタデータ（tokenURI）はチェーン上で JSON を組み立てる。画像だけ imageBase の URL に置く。
 */
contract BeerJugSBT is IERC5192, ERC721, Ownable {
    using Strings for uint256;

    struct Badge {
        uint8 kind;
        uint64 mintedAt;   // 発行した日時（block.timestamp、UNIX 秒）
    }

    string private constant SITE = "https://kawade502.github.io/beer-jug/";
    bytes4 private constant ERC4906_INTERFACE_ID = 0x49064906;

    /// 発行した数。tokenId は 1 からの通し番号（burn しても番号は詰めない）
    uint256 public totalMinted;
    /// 画像の置き場所。末尾は "/"。この後ろに kanpai.png などを付ける
    string public imageBase = "https://kawade502.github.io/beer-jug/sbt/";
    /// (アドレス, 種類) ごとに発行済みか。burn しても true のまま残す。
    /// 同じ人に同じ記念を二度出さないため（運営者がうっかり二重に mint しても失敗する）。
    mapping(address => mapping(uint8 => bool)) public issued;
    mapping(uint256 => Badge) private _badges;

    error Soulbound();
    error InvalidKind(uint8 kind);
    error AlreadyIssued(address to, uint8 kind);
    error NotTokenOwner(uint256 tokenId);
    error InvalidImageBase();

    event ImageBaseChanged(string imageBase);
    event ContractURIUpdated();   // ERC-7572

    constructor() ERC721("Beer Jug Memorial", "BEERJUG") Ownable(msg.sender) {}

    // ---- 発行（運営者だけ） ----

    /// 1 件発行する。kind は 1〜3。
    function mint(address to, uint8 kind) external onlyOwner returns (uint256) {
        return _mintBadge(to, kind);
    }

    /// 同じ種類をまとめて発行する。1 件でも失敗したら、全部取り消しになる。
    function mintBatch(address[] calldata to, uint8 kind) external onlyOwner {
        for (uint256 i = 0; i < to.length; i++) {
            _mintBadge(to[i], kind);
        }
    }

    function _mintBadge(address to, uint8 kind) private returns (uint256 tokenId) {
        if (kind < 1 || kind > 3) revert InvalidKind(kind);
        if (to == address(0)) revert ERC721InvalidReceiver(address(0));
        if (issued[to][kind]) revert AlreadyIssued(to, kind);
        issued[to][kind] = true;

        tokenId = ++totalMinted;
        _badges[tokenId] = Badge(kind, uint64(block.timestamp));
        _mint(to, tokenId);   // _safeMint にしない（受け取り側のコントラクトを呼ばない）
        emit Locked(tokenId);
    }

    /// 持ち主が自分の SBT を消す。発行済みの記録（issued）は残るので、同じ記念はもう受け取れない。
    function burn(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId);
        delete _badges[tokenId];
        _burn(tokenId);
    }

    // ---- 譲渡できないようにする ----

    /// mint（from が 0）と burn（to が 0）だけ通す。
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    /// ERC-5192。ある token はいつも true。無い token は失敗する。
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5192).interfaceId   // 0xb45a3c0e
            || interfaceId == ERC4906_INTERFACE_ID
            || super.supportsInterface(interfaceId);
    }

    // ---- メタデータ ----

    /// token の種類と発行日時。
    function badgeOf(uint256 tokenId) external view returns (uint8 kind, uint64 mintedAt) {
        _requireOwned(tokenId);
        Badge memory b = _badges[tokenId];
        return (b.kind, b.mintedAt);
    }

    /// 種類ごとの名前・杯数・画像のファイル名。
    function _kindInfo(uint8 kind) private pure returns (string memory label, uint256 cups, string memory file) {
        if (kind == 1) return (unicode"乾杯", 2, "kanpai.png");
        if (kind == 2) return (unicode"常連さん", 5, "joren.png");
        return (unicode"名誉店主", 10, "meiyo.png");
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Badge memory b = _badges[tokenId];
        (string memory label, uint256 cups, string memory file) = _kindInfo(b.kind);

        string memory head = string.concat(
            '{"name":"', unicode"ビールジョッキ「", label, unicode"」 #", tokenId.toString(),
            '","description":"', unicode"スマホのビールジョッキ（", SITE, unicode"）で、ビールを",
            cups.toString(), unicode"杯飲み干した記念のトークンです。譲渡できません（SBT）。金銭的な価値はありません。",
            '","image":"', imageBase, file,
            '","external_url":"', SITE, '",'
        );
        string memory attrs = string.concat(
            '"attributes":[{"trait_type":"', unicode"記念", '","value":"', label,
            '"},{"trait_type":"', unicode"杯数", '","display_type":"number","value":', cups.toString(),
            '},{"trait_type":"', unicode"発行日", '","display_type":"date","value":', uint256(b.mintedAt).toString(),
            '}]}'
        );
        return _dataUri(string.concat(head, attrs));
    }

    /// コレクション全体の説明（OpenSea などが読む）。
    function contractURI() external view returns (string memory) {
        return _dataUri(string.concat(
            '{"name":"', name(),
            '","description":"', unicode"スマホのビールジョッキ（", SITE,
            unicode"）で、ビールを飲み干した杯数の記念 SBT です。乾杯（2杯）・常連さん（5杯）・名誉店主（10杯）の3種類。譲渡できません。金銭的な価値はありません。",
            '","image":"', imageBase, 'meiyo.png","external_link":"', SITE, '"}'
        ));
    }

    function _dataUri(string memory json) private pure returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// 画像の置き場所を変える（ホスティングを移したとき）。JSON が壊れないよう、引用符・\・制御文字は入れられない。
    function setImageBase(string calldata base) external onlyOwner {
        bytes memory s = bytes(base);
        for (uint256 i = 0; i < s.length; i++) {
            if (s[i] == '"' || s[i] == "\\" || uint8(s[i]) < 0x20) revert InvalidImageBase();
        }
        imageBase = base;
        emit ImageBaseChanged(base);
        if (totalMinted > 0) emit IERC4906.BatchMetadataUpdate(1, totalMinted);   // ERC-4906。マーケットに読み直してもらう
        emit ContractURIUpdated();
    }
}
