# KV Cache Manager for SillyTavern

[Русская версия](README.ru.md) | **English**

An extension for managing KV cache of llama.cpp server with automatic saving and loading. Supports both single and group chats with multiple characters.

## Installation

Through SillyTavern extensions menu.

### Manual Installation

1. Copy the `kv-cache-manager` folder to `public/scripts/extensions/` in your SillyTavern installation
2. Reload the SillyTavern page
3. The extension will appear in settings under the "KV Cache Manager" tab

### Server Plugin

For file loading functionality, you need to install the server plugin:

**KV Cache Manager Server Plugin**: [https://github.com/fortrest-jr/kv_cache-manager-plugin](https://github.com/fortrest-jr/kv_cache-manager-plugin)

The plugin provides API for getting the list of save files and deleting them. Without the plugin, the cache loading function will be unavailable.

## Use Cases

### Use Case 1: Regular Chat with One Character

1. **Getting Started**: Open a chat with a character and start generating a response
   - The extension will automatically allocate a slot for the character
   - On first generation, the cache will be empty

2. **Automatic Saving**: After every N messages (default: 5), the cache is automatically saved
   - The indicator in the extension header shows the number of messages until the next save
   - Old autosaves are automatically deleted when the limit is exceeded

3. **Automatic Loading**: On the next response generation, the last saved cache is automatically loaded
   - A notification shows the date/time of the loaded cache

4. **Manual Saving of Important Moments**: 
   - Click "Save with Name" and enter a tag (e.g., "important_moment")
   - The cache will be saved with the tag and won't be deleted during autosave rotation

### Use Case 2: Group Chat with Multiple Characters

1. **Slot Distribution**: When generating responses for different characters, they are automatically distributed across available slots
   - Each character gets their own slot
   - Usage counter is tracked separately for each slot

2. **Slot Eviction**: If there are fewer slots than characters:
   - The character with the least usage is evicted
   - Before eviction, the cache is automatically saved (if used at least 1 time)
   - The new character occupies the freed slot

3. **Independent Autosave**: Each character has their own message counter
   - Cache is saved independently for each character
   - File rotation occurs separately for each character

4. **Saving Individual Slots**: 
   - In the slot management interface, there's a save button for each slot
   - Allows saving the cache of a specific character without saving the others

### Use Case 3: Switching Between Chats

1. **Automatic Saving**: When switching to another chat:
   - Cache of all characters in the current chat is automatically saved (if used at least 1 time)
   - All slots are cleared on the server

2. **New Chat Distribution**: Characters of the new chat are automatically distributed across slots
   - For group chats, all participants are distributed across available slots
   - For regular chats, one character occupies the first slot

3. **Autoload on Generation**: On first generation in a new chat:
   - The last saved cache for each character from this chat is automatically loaded
   - If no cache exists, generation continues with an empty cache

### Use Case 4: Manual Loading of Saves

1. **Opening Load Popup**: Click the "Load Cache" button

2. **Selecting Chat**: 
   - Current chat is displayed first with "[current]" label
   - You can select any other chat from the list
   - Search by chat name for quick access

3. **Selecting Characters**:
   - Within the selected chat, all characters with saves are displayed
   - Each character can have multiple saves (expand the group)
   - Select the desired save for each character (click on date/time)
   - You can select multiple characters simultaneously

4. **Loading**:
   - Click the "Load" button
   - Caches are loaded into corresponding slots
   - If the character is already in a slot, the cache is loaded into that slot
   - If the character is not in slots, a new slot is allocated for them

5. **Loading from Another Chat**:
   - You can load a character's cache from another chat
   - The notification will indicate which chat the cache was loaded from

### Use Case 5: Preloading Cache for Group Chats

1. **Opening Preload Popup**: 
   - Click "Create Cache for Group Characters" button (only available in group chats)
   - A popup will open showing all characters in the group chat

2. **Selecting Characters**:
   - By default, all non-muted characters are selected
   - You can select/deselect characters using checkboxes
   - Muted characters are shown but not selected by default
   - Use "Select All" checkbox to select/deselect all characters
   - Search by character name for quick access

3. **Preloading Process**:
   - Click "Start Preload" to begin
   - For each selected character, the extension will:
     - Switch to that character's context
     - Generate a quiet prompt (1 token) to warm up the cache
     - Save the cache automatically
   - Progress is shown in a status message with:
     - Current character being preloaded
     - Progress counter (X/Total)
     - List of successfully preloaded characters
     - List of errors (if any)
   - You can cancel the process at any time

4. **Benefits**:
   - All characters have their cache ready before actual conversations
   - Faster response times during group chat interactions
   - Automatic slot allocation and cache management

### Use Case 6: Managing Saves

1. **Manual Save with Tag**: 
   - Click "Save with Name"
   - Enter a tag (e.g., "end_of_chapter_1")
   - Cache of all active characters will be saved with this tag
   - Saves with tags are not deleted during autosave rotation

2. **Instant Save**: 
   - Click "Save Now"
   - Cache will be saved without a tag (as autosave)
   - Message counters will be reset for all characters

3. **Freeing Slots**: 
   - Click "Clear All Slots"
   - All slots will be cleared (cache on server is not deleted)
   - Useful for forcing character redistribution

## Key Features

### Automatic Saving
- **Smart Autosave**: Cache is automatically saved for each character separately after every N messages (configurable)
- **Individual Counters**: Each character has their own message counter, allowing independent cache saving for different characters
- **Visual Indicator**: Display of the number of messages until the next autosave in the extension header
- **Automatic Rotation**: Old autosaves are automatically deleted when the limit is exceeded (configurable separately for each character)

### Manual Saving
- **Save with Tag**: Save cache for all active characters with a specified tag (save name)
- **Instant Save**: Save without tag for all active characters (on-demand autosave)
- **Save Individual Slots**: Save button for each slot separately directly from the slot management interface

### Automatic Loading
- **Load on Generation**: When starting to generate a character's response, the last saved cache from the current chat is automatically loaded
- **Smart Slot Management**: Automatic distribution of characters across slots with eviction of least used ones
- **Save Before Eviction**: Character cache is automatically saved before eviction from slot (if used at least 1 time)

### Preloading for Group Chats
- **Batch Cache Creation**: Create cache for multiple characters in group chats at once
- **Quiet Generation**: Uses quiet generation mode (1 token) to warm up cache without visible messages
- **Progress Tracking**: Real-time status updates showing current character, progress, and results
- **Cancellable**: Can be cancelled at any time during the process
- **Selective Preloading**: Choose which characters to preload (muted characters excluded by default)
- **Automatic Slot Management**: Characters are automatically assigned to slots during preloading

### Manual Loading
- **Interactive Popup**: Convenient interface for selecting and loading saves
- **Grouped by Chats**: Saves are organized by chats with the ability to select any chat
- **Grouped by Characters**: Within each chat, saves are grouped by characters
- **Multiple Selection**: Ability to select multiple characters for simultaneous loading
- **Search**: Search by chat name or character name
- **Save Information**: Display of save date/time and tags

### Slot Management
- **Automatic Distribution**: Characters are automatically distributed across slots during generation
- **Usage Tracking**: Usage counter for each slot to optimize eviction
- **Visual Interface**: Display of all slots' status with information about characters and usage
- **Freeing Slots**: Button to free all slots manually

### Management on Chat Change
- **Automatic Saving**: When switching to another chat, cache of all characters is automatically saved (if the character used the slot at least 1 time)
- **Slot Clearing**: Automatic clearing of all slots before distributing characters of the new chat
- **Character Distribution**: Automatic distribution of new chat characters across slots

### Validation and Security
- **File Size Check**: Automatic check of saved file sizes (files smaller than 1 MB are considered invalid and deleted)
- **Error Handling**: Proper error handling with informative messages
- **Data Loss Protection**: Saving cache before evicting characters from slots

## Settings

### Enable Autosave
- **Description**: Enables/disables automatic cache saving
- **Default**: Enabled
- **Recommendations**: Recommended to keep enabled for automatic progress saving

### Save Every N Messages
- **Description**: Interval for automatic cache saving for each character
- **Default**: 5 messages
- **How it works**: Each character has their own message counter. When the counter reaches the specified value, the cache is automatically saved and the counter is reset
- **Recommendations**: 
  - Smaller values (3-5) - for frequent saving, more disk space
  - Larger values (10-20) - for rare saving, save space

### Maximum Files per Character
- **Description**: Maximum number of autosaves for each character in each chat
- **Default**: 10 files
- **How it works**: When the limit is exceeded, old autosaves are automatically deleted (new ones are saved)
- **Important**: Manual saves with tags are not counted in this limit and are not deleted
- **Recommendations**: 
  - 5-10 files - to save space
  - 15-20 files - for more restore points

### Show Notifications
- **Description**: Enables/disables toast notifications about saving, loading, and other operations
- **Default**: Enabled
- **Recommendations**: Disable if notifications interfere with work

### Clear on Chat Change
- **Description**: Automatically saves cache and clears slots when switching to another chat
- **Default**: Enabled
- **How it works**: 
  - When changing chats, cache of all characters is saved (if used at least 1 time)
  - All slots are cleared on the server
  - Characters of the new chat are distributed across slots
- **Recommendations**: 
  - Enabled - for automatic management when working with multiple chats
  - Disabled - if you want to manually manage switching between chats

### Preload Timeout (minutes)
- **Description**: Maximum time to wait for each character's cache generation during preload
- **Default**: 20 minutes
- **How it works**: 
  - When preloading cache for group chat characters, each character has a timeout
  - If generation takes longer than the timeout, it will be cancelled and marked as error
  - The process continues with the next character
- **Recommendations**: 
  - 10-15 minutes - for faster models or smaller contexts
  - 20-30 minutes - for slower models or larger contexts
  - Increase if you experience frequent timeouts during preloading

## File Format

The extension uses a unified file naming format for all types of saves:

### Autosaves (without tag)
```
{chatId}_{timestamp}_character_{characterName}.bin
```

**Example**: `chat1_20240115143022_character_Alice.bin`

### Manual Saves (with tag)
```
{chatId}_{timestamp}_tag_{tag}_character_{characterName}.bin
```

**Example**: `chat1_20240115143022_tag_important_moment_character_Alice.bin`

### File Name Structure
- **chatId**: Normalized chat name (without special characters)
- **timestamp**: Timestamp in format `YYYYMMDDHHmmss` (14 digits)
- **tag**: Tag for manual save (optional, only for manual saves)
- **characterName**: Character name (used for identification when loading)

### Important Features
- **Character Names Instead of Slots**: Files are named by characters, not by slot numbers, ensuring correct loading even when slot order changes
- **Name Normalization**: All names (chat, character, tag) are normalized for safe use in file names
- **Backward Compatibility**: Support for parsing old file formats (with slot numbers) for compatibility

### File Validation
- Files smaller than 1 MB are considered invalid and automatically deleted
- Size check occurs after saving with a small delay (500 ms)

## Technical Details

### Slot Management

The extension uses the llama.cpp server slot system to manage cache for multiple characters simultaneously.

**Slot Allocation Algorithm:**
1. If the character is already in a slot - the existing slot is used
2. If there's a free slot - the character occupies it
3. If there are no free slots - the character with the lowest usage counter is evicted
4. Before eviction, the cache is saved (if used at least 1 time)

**Usage Counter:**
- Increases on each new response generation (`type === 'normal'`) or if counter is 0
- Does not increase on swipe or continue if counter is already greater than 0
- Resets to 0 when loading cache
- Used to determine the least used slot during eviction

### Generation Interception

The extension uses SillyTavern's generation interceptor mechanism to automatically load cache before generating a response.

**Generation Types:**
- `normal` - normal generation (increases usage counter)
- `regenerate` - regeneration (increases counter if equal to 0)
- `swipe` - swipe (does not increase counter if greater than 0)
- `continue` - continue (does not increase counter if greater than 0)
- `quiet` - quiet generation (used for preloading, increases counter if equal to 0)
- `impersonate` - generation on behalf of user (skipped)

### SillyTavern Events

The extension subscribes to the following events:
- `GENERATE_BEFORE_COMBINE_PROMPTS` - updating slot list before generation
- `TEXT_COMPLETION_SETTINGS_READY` - setting `id_slot` for generation
- `MESSAGE_RECEIVED` - processing messages for autosave
- `CHAT_CHANGED` - processing chat change

### Name Normalization

All names (chat, character, tag) are normalized for safe use:
- Removal of special characters
- Replacement of spaces with underscores
- Conversion to unified format

This ensures correct operation with the file system and prevents encoding issues.

## Requirements

- **SillyTavern**: Version with support for extensions and generation interceptor mechanism
- **llama.cpp server**: 
  - KV cache support
  - API for working with slots (`/slots`, `/slot/load`, `/slot/save`, `/slot/clear`)
  - Support for `id_slot` parameter in generation requests
- **Server Plugin**: [kv_cache-manager-plugin](https://github.com/fortrest-jr/kv_cache-manager-plugin)
  - Provides API for getting file list (`/api/files/list`)
  - Provides API for deleting files (`/api/files/delete`)
  - Without the plugin, the cache loading function will be unavailable

## License

MIT
