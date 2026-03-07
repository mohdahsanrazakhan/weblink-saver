// Cross-browser compatibility (Chrome + Firefox)
const extAPI = typeof browser !== "undefined" ? browser : chrome;

// Global variable for edit mode
let currentEditKey = null;

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function () {
        const tabName = this.dataset.tab;

        // Update tab buttons
        document.querySelectorAll('.tab').forEach(t => {
            t.classList.remove('active');
        });
        this.classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.add('hidden');
        });
        document.getElementById(tabName + 'Tab').classList.remove('hidden');

        // Load list when switching to list tab
        if (tabName === 'list') {
            loadURLList();
        }
    });
});

// Save URL
document.getElementById('save').addEventListener('click', function () {
    extAPI.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        let tab = tabs[0];
        let title = document.getElementById('title').value || tab.title;
        let description = document.getElementById('description').value;
        let label = document.getElementById('label').value;

        if (!title.trim()) {
            showStatus('Please enter a title', 'error');
            return;
        }

        let urlData = {
            url: tab.url,
            title: title.trim(),
            description: description.trim(),
            label: label.trim(),
            savedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Use a unique key with timestamp to avoid overwriting
        const key = `url_${Date.now()}`;

        extAPI.storage.local.set({ [key]: urlData }, function () {
            showStatus('URL saved successfully!', 'success');
            // Clear form
            document.getElementById('title').value = '';
            document.getElementById('description').value = '';
            document.getElementById('label').value = '';
        });
    });
});

// WhatsApp notification
document.getElementById('notify').addEventListener('click', function () {
    extAPI.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        let tab = tabs[0];
        let message = `Check this out: ${tab.title} - ${tab.url}`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`);
    });
});

// Notion Integration - One-time setup, then automatic save
document.getElementById('notionSave').addEventListener('click', function () {
    extAPI.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        let tab = tabs[0];

        // Check if Notion is already configured
        extAPI.storage.local.get(['notionConfigured', 'notionApiKey', 'notionDatabaseId'], function (result) {
            if (result.notionConfigured) {
                // Already configured - directly save
                saveToNotion(tab, result.notionApiKey, result.notionDatabaseId);
            } else {
                // First time - show setup modal
                showNotionSetup(tab);
            }
        });
    });
});

// Show Notion setup modal (one-time only)
function showNotionSetup(tab) {
    const setup = confirm(
        '⚙️ Notion Setup (One-time only)\n\n' +
        'Step 1: Create a Notion integration at:\n' +
        'https://www.notion.so/my-integrations\n\n' +
        'Step 2: Copy API Key & Database ID\n\n' +
        'Click OK to continue setup'
    );

    if (!setup) return;

    // Get API Key
    const apiKey = prompt(
        '🔑 Step 1/2: Enter Notion API Key\n\n' +
        '(Get from: https://www.notion.so/my-integrations)\n' +
        'Create integration → Copy "Internal Integration Token"'
    );

    if (!apiKey) {
        showStatus('Setup cancelled', 'error');
        return;
    }

    // Get Database ID
    const dbId = prompt(
        '📊 Step 2/2: Enter Database ID\n\n' +
        'How to get Database ID:\n' +
        '1. Open your Notion database\n' +
        '2. Click "..." → Copy link\n' +
        '3. Paste link here (we\'ll extract ID)\n\n' +
        'Or paste just the 32-character ID'
    );

    if (!dbId) {
        showStatus('Setup cancelled', 'error');
        return;
    }

    // Extract database ID from URL if full URL is provided
    let databaseId = dbId;
    if (dbId.includes('notion.so')) {
        // Extract ID from URL: https://notion.so/username/dbname-XXXXX?v=XXXXX
        const match = dbId.match(/([a-f0-9]{32})/);
        if (match) {
            databaseId = match[1];
        }
    }

    // Remove any hyphens from database ID
    databaseId = databaseId.replace(/-/g, '');

    // Save configuration
    extAPI.storage.local.set({
        notionConfigured: true,
        notionApiKey: apiKey,
        notionDatabaseId: databaseId
    }, function () {
        showStatus('✅ Notion configured! Saving URL...', 'success');
        saveToNotion(tab, apiKey, databaseId);
    });
}

// Save to Notion function - Smart version that detects property names
function saveToNotion(tab, apiKey, databaseId) {
    const title = document.getElementById('title').value || tab.title;
    const description = document.getElementById('description').value || '';
    const label = document.getElementById('label').value || '';

    // First, get database schema to find property names
    fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Notion-Version': '2022-06-28'
        }
    })
        .then(response => response.json())
        .then(database => {
            // Check if response is valid
            if (!database.properties) {
                throw new Error('Invalid database response. Check database ID and permissions.');
            }

            // Find the title property (it's required in every database)
            let titleProp = null;
            let urlProp = null;
            let descProp = null;
            let tagsProp = null;

            // Loop through properties to find them
            for (let [propName, propData] of Object.entries(database.properties)) {
                if (propData.type === 'title') {
                    titleProp = propName;
                } else if (propData.type === 'url') {
                    urlProp = propName;
                } else if (propData.type === 'rich_text' && !descProp) {
                    descProp = propName;
                } else if (propData.type === 'multi_select') {
                    tagsProp = propName;
                }
            }

            if (!titleProp) {
                throw new Error('No title property found in database');
            }

            // Build payload with detected property names
            const payload = {
                parent: { database_id: databaseId },
                properties: {
                    [titleProp]: {
                        title: [{ text: { content: title } }]
                    }
                }
            };

            // Add URL if property exists
            if (urlProp) {
                payload.properties[urlProp] = { url: tab.url };
            }

            // Add Description if property exists and value provided
            if (descProp && description) {
                payload.properties[descProp] = {
                    rich_text: [{ text: { content: description } }]
                };
            }

            // Add Tags if property exists and label provided
            if (tagsProp && label) {
                payload.properties[tagsProp] = {
                    multi_select: [{ name: label }]
                };
            }

            // Now create the page
            return fetch('https://api.notion.com/v1/pages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Notion-Version': '2022-06-28'
                },
                body: JSON.stringify(payload)
            });
        })
        .then(response => response.json())
        .then(data => {
            if (data.object === 'page') {
                showStatus('✅ Saved to Notion successfully!', 'success');
            } else {
                throw new Error(data.message || 'Failed to save');
            }
        })
        .catch(error => {
            console.error('Notion error:', error);

            let errorMsg = error.message || 'Unknown error';

            // Specific error messages
            if (errorMsg.includes('not a property')) {
                errorMsg = '❌ Database properties mismatch!\n\nTry: Reset configuration and setup again';
            } else if (errorMsg.includes('unauthorized') || errorMsg.includes('Invalid database')) {
                errorMsg = '❌ Check: Did you share database with integration?\n\nOr API key might be wrong';
            } else if (errorMsg.includes('object_not_found')) {
                errorMsg = '❌ Database not found! Check database ID';
            }

            showStatus(errorMsg, 'error');

            // Reset option
            setTimeout(() => {
                if (confirm('Want to reset Notion configuration?')) {
                    extAPI.storage.local.remove(['notionConfigured', 'notionApiKey', 'notionDatabaseId'], function () {
                        showStatus('Configuration reset!', 'success');
                    });
                }
            }, 3000);
        });
}

// Add settings option to reset Notion configuration (optional)
// You can add this as a button in settings or list view
function resetNotionConfig() {
    if (confirm('Reset Notion configuration?')) {
        extAPI.storage.local.remove(['notionConfigured', 'notionApiKey', 'notionDatabaseId'], function () {
            showStatus('Notion configuration reset!', 'success');
        });
    }
}

// Format timestamp to readable format
function formatTimestamp(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

// Get badge color for labels
function getBadgeClass(label) {
    const colors = ['badge-primary', 'badge-secondary', 'badge-green', 'badge-purple', 'badge-pink'];

    // Generate consistent color based on label text
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
        hash = label.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
}

// Load and display URL list
function loadURLList() {
    extAPI.storage.local.get(null, function (items) {
        const urlList = document.getElementById('urlList');
        const urls = Object.entries(items).filter(([key]) => key.startsWith('url_'));

        if (urls.length === 0) {
            urlList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <div class="empty-state-title">No saved URLs yet</div>
                    <div class="empty-state-description">Start saving your favorite links to access them anytime</div>
                </div>
            `;
            return;
        }

        // Sort by saved date (newest first)
        urls.sort((a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt));

        urlList.innerHTML = urls.map(([key, data]) => {
            const savedTime = formatTimestamp(data.savedAt);
            const updatedTime = data.updatedAt && data.updatedAt !== data.savedAt
                ? ` • Edited ${formatTimestamp(data.updatedAt)}`
                : '';

            const badgeClass = data.label ? getBadgeClass(data.label) : '';

            return `
                <div class="url-item" data-key="${key}">
                    <div class="url-item-header">
                        <div>
                            ${data.label ? `<span class="badge ${badgeClass}">${data.label}</span>` : ''}
                        </div>
                        <div class="menu-action-btn">
                            <!-- Three Dots -->
                            <svg class="icon-dots" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3"/>
                            </svg>

                            <!-- X Icon -->
                            <svg class="icon-close" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
                            </svg>
                        </div>
                    </div>
                    
                    <div class="url-item-title">${data.title}</div>
                    
                    ${data.description ? `<div class="url-item-description">${data.description}</div>` : ''}
                    
                    <div class="url-item-url">${data.url}</div>
                    
                    <div class="url-item-meta">
                        Saved ${savedTime}${updatedTime}
                    </div>
                    
                    <div class="url-item-actions">
                        <button class="btn btn-sm btn-secondary open-url" data-url="${data.url}">
                            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-external-link"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" /><path d="M11 13l9 -9" /><path d="M15 4h5v5" /></svg></span>
                            <span>Open</span>
                        </button>
                        <button class="btn btn-sm btn-secondary copy-url" data-url="${data.url}">
                            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-copy"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666" /><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" /></svg></span>
                            <span>Copy</span>
                        </button>
                        <button class="btn btn-sm btn-ghost edit-url" data-key="${key}">
                            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-edit"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" /><path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415" /><path d="M16 5l3 3" /></svg></span>
                            <span>Edit</span>
                        </button>
                        <button class="btn btn-sm btn-destructive delete-url" data-key="${key}">
                            <span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-trash"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M4 7l16 0" /><path d="M10 11l0 6" /><path d="M14 11l0 6" /><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" /><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" /></svg></span>
                            <span>Delete</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Add event listeners
        addURLListeners();
    });
}

// Add event listeners to URL list items
function addURLListeners() {
    // Open URL
    document.querySelectorAll('.open-url').forEach(btn => {
        btn.addEventListener('click', function () {
            extAPI.tabs.create({ url: this.dataset.url });
        });
    });

    // Copy URL
    document.querySelectorAll('.copy-url').forEach(btn => {
        btn.addEventListener('click', function () {
            navigator.clipboard.writeText(this.dataset.url).then(() => {
                showStatus('URL copied to clipboard!', 'success');
            });
        });
    });

    // Edit URL
    document.querySelectorAll('.edit-url').forEach(btn => {
        btn.addEventListener('click', function () {
            const key = this.dataset.key;
            openEditModal(key);
        });
    });

    // Delete URL
    document.querySelectorAll('.delete-url').forEach(btn => {
        btn.addEventListener('click', function () {
            if (confirm('Are you sure you want to delete this URL?')) {
                const key = this.dataset.key;
                extAPI.storage.local.remove(key, function () {
                    showStatus('URL deleted successfully', 'success');
                    loadURLList();
                });
            }
        });
    });
}

// Open edit modal
function openEditModal(key) {
    currentEditKey = key;

    extAPI.storage.local.get(key, function (items) {
        const data = items[key];

        if (data) {
            document.getElementById('editTitle').value = data.title || '';
            document.getElementById('editDescription').value = data.description || '';
            document.getElementById('editLabel').value = data.label || '';

            document.getElementById('editModal').classList.add('active');
        }
    });
}

// Close edit modal
function closeEditModal() {
    document.getElementById('editModal').classList.remove('active');
    currentEditKey = null;

    // Clear form
    document.getElementById('editTitle').value = '';
    document.getElementById('editDescription').value = '';
    document.getElementById('editLabel').value = '';
}

// Update URL
document.getElementById('updateBtn').addEventListener('click', function () {
    if (!currentEditKey) return;

    const title = document.getElementById('editTitle').value.trim();

    if (!title) {
        showStatus('Please enter a title', 'error');
        return;
    }

    extAPI.storage.local.get(currentEditKey, function (items) {
        const data = items[currentEditKey];

        if (data) {
            // Update with new values
            data.title = title;
            data.description = document.getElementById('editDescription').value.trim();
            data.label = document.getElementById('editLabel').value.trim();
            data.updatedAt = new Date().toISOString();

            extAPI.storage.local.set({ [currentEditKey]: data }, function () {
                showStatus('URL updated successfully!', 'success');
                closeEditModal();
                loadURLList();
            });
        }
    });
});

// Cancel edit
document.getElementById('cancelBtn').addEventListener('click', closeEditModal);

// Close modal on outside click
document.getElementById('editModal').addEventListener('click', function (e) {
    if (e.target === this) {
        closeEditModal();
    }
});

// Refresh list button
document.getElementById('refresh').addEventListener('click', loadURLList);

// Show status message
function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.classList.remove('hidden');

    if (type === 'success') {
        status.className = 'alert alert-success';
    } else {
        status.className = 'alert alert-error';
    }

    setTimeout(() => {
        status.classList.add('hidden');
    }, 3000);
}

// Toggle the action buttons when click on three dots
document.addEventListener('click', function(e) {
    const btn = e.target.closest('.menu-action-btn');
    if (!btn) return;

    const parentItem = btn.closest('.url-item');
    const actions = parentItem.querySelector('.url-item-actions');

    actions.classList.toggle('active');
    btn.classList.toggle('active');
});


// Load current tab info when popup opens
extAPI.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0]) {
        document.getElementById('title').value = tabs[0].title;
    }
});