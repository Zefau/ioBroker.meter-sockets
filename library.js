'use strict';
const _sodium = require('libsodium-wrappers');
const _concat = require("concat-typed-array");

/**
 * Library
 *
 * @description Library of general functions as well as helping functions handling ioBroker
 * @author Zefau <https://github.com/Zefau/>
 * @license MIT License
 * @version 0.6.0
 *
 */
class Library
{
	/**
	 * Constructor.
	 *
	 * @param	{object}	adapter		ioBroker adpater object
	 *
	 */
    constructor(adapter)
	{
		this._adapter = adapter;
    }
	
	/**
	 * Generates an encryption key.
	 *
	 * @param	void
	 * @return	{string}				Encryption key
	 *
	 */
	getEncryptionKey()
	{
		return _sodium.to_hex(_sodium.crypto_secretbox_keygen());
	}
	
	/**
	 * Encrypts a message with given key.
	 *
	 * @param	{string}	key			Key to be used to encrypt message
	 * @param	{string}	message		Message to be encrypted
	 * @return	{string}				Encrypted message
	 *
	 */
	encrypt(key, message)
	{
		var nonce = _sodium.randombytes_buf(_sodium.crypto_secretbox_NONCEBYTES);
		try
		{
			return _sodium.to_hex(_concat(Uint8Array, nonce, _sodium.crypto_secretbox_easy(message, nonce, _sodium.from_hex(key))));
		}
		catch(e)
		{
			this._adapter.log.warn(e.message);
			return false;
		}
	}
	
	/**
	 * Decrypts a message with given key.
	 *
	 * @param	{string}	key			Key to be used to decrypt message
	 * @param	{string}	message		Message to be decrypted
	 * @return	{string}				Decrypted message
	 *
	 */
	decrypt(key, message)
	{
		try
		{
			message = _sodium.from_hex(message);
			return _sodium.to_string(_sodium.crypto_secretbox_open_easy(message.slice(_sodium.crypto_secretbox_NONCEBYTES), message.slice(0, _sodium.crypto_secretbox_NONCEBYTES), _sodium.from_hex(key)));
		}
		catch(e)
		{
			this._adapter.log.warn(JSON.stringify(e.message));
			return false;
		}
	}

	/**
	 * Convert an integer to IP.
	 *
	 * @param	{integer}	number		Number to be converted to IP address
	 * @return	{string}				Converted IP address
	 *
	 */
	getIP(number)
	{
		var ip = [];
		ip.push(number & 255);
		ip.push((number >> 8) & 255);
		ip.push((number >> 16) & 255);
		ip.push((number >> 24) & 255);
		
		ip.reverse();
		return ip.join('.');
	}
	
	/**
	 * Sends a message to another adapter.
	 *
	 * @param	{string}	receiver	
	 * @param	{string}	command		
	 * @param	{*}			message		Message to send to receiver, shall be an object and will be converted to such if another is given
	 * @param	{function}	(optional)	Callback
	 * @return	void
	 *
	 */
	msg(receiver, command, message, callback)
	{
		this._adapter.sendTo(
			receiver,
			command,
			typeof message !== 'object' ? {message: message} : message,
			callback === undefined ? function() {} : callback
		);
	}

	/**
	 * Convert a timestamp to datetime.
	 *
	 * @param	{integer}	timestamp		Timestamp to be converted to date-time format
	 * @return	{string}					Timestamp in date-time format
	 *
	 */
	getDateTime(timestamp)
	{
		if (timestamp === undefined || timestamp <= 0)
			return '';
		
		var date    = new Date(timestamp);
		var day     = '0' + date.getDate();
		var month   = '0' + (date.getMonth() + 1);
		var year    = date.getFullYear();
		var hours   = '0' + date.getHours();
		var minutes = '0' + date.getMinutes();
		var seconds = '0' + date.getSeconds();
		return day.substr(-2) + '.' + month.substr(-2) + '.' + year + ' ' + hours.substr(-2) + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);
	}

	/**
	 * Set a value and create the necessary state for it in case it is missing.
	 *
	 * @param	{object}	node					
	 * @param	{string}	node.node				Node (= state) to set the value (and create in case it does not exist)
	 * @param	{string}	node.description		Description of the node (in case it will be created)
	 * @param	{object}	node.common				Common Details of the node (in case it will be created)
	 * @param	{string}	node.common.role		Role of the node (in case it will be created)
	 * @param	{string}	node.common.type		Type of the node (in case it will be created)
	 * @param	{object}	node.native				Native Details of the node (in case it will be created)
	 * @param	{string}	value					Value to set (in any case)
	 * @return	void
	 *
	 */
	set(node, value)
	{
		var that = this;
		this._adapter.getObject(node.node, function(err, obj)
		{
			// catch error
			if (err)
				that._adapter.log.error(err);
			
			// create node if non-existent
			if (err || !obj) {
				that._adapter.log.debug('Creating node ' + node.node);
				that._createNode(node, that._setValue(node.node, value));
			}
			
			// set value
			else
				that._setValue(node.node, value);
		});
	}
	
	/**
	 * Creates an object (channel or state).
	 *
	 * @param	{object}	node					
	 * @param	{string}	node.node				Node (= state) to set the value (and create in case it does not exist)
	 * @param	{string}	node.description		Description of the node (in case it will be created)
	 * @param	{object}	node.common				Common Details of the node (in case it will be created)
	 * @param	{string}	node.common.role		Role of the node (in case it will be created)
	 * @param	{string}	node.common.type		Type of the node (in case it will be created)
	 * @param	{object}	node.native				Native Details of the node (in case it will be created)
	 * @param	{function}	callback				Callback function to be invoked
	 * @return	void
	 *
	 */
	_createNode(node, callback)
	{
		var common = {};
		if (node.description !== undefined) common.name = node.description;
		if (node.role !== undefined) common.role = node.role;
		if (node.type !== undefined) common.type = node.type;
		
		this._adapter.setObject(node.node, {common: Object.assign({role: 'state', type: 'string'}, node.common || {}, common), type: 'state', native: node.native || {}}, callback);
	}

	/**
	 * Sets a value of a state.
	 *
	 * @param	{string}	state		State the value shall be set
	 * @param	{string}	value		Value to be set
	 * @return	void
	 *
	 */
	_setValue(state, value)
	{
		var that = this;
		if (value !== undefined)
			this._adapter.setState(state, {val: value, ts: Date.now(), ack: true}, function(err) {if (err) that._adapter.log.error(err);})
	}
}

module.exports = Library;
