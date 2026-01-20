// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract LifeToken is ERC20, ERC20Burnable, Ownable {
    // Costruttore: inizializza il token e imposta il proprietario iniziale.
    constructor(address initialOwner)
        ERC20("LifeQuest Token", "LIFE")
        Ownable(initialOwner)
    {}

    // Crea nuove monete e le assegna all'indirizzo specificato (solo il proprietario puo' farlo).
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
