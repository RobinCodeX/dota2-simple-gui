import * as path from 'path';
import * as vscode from 'vscode';
import { KeyValues3, loadFromString, emptyKeyValues, KeyValues3Type, formatKeyValues, NewKeyValue, NewKeyValuesArray } from 'easy-keyvalues/dist/kv3';
import { GetNonce, writeDocument, initializeKV3ToDocument, RequestHelper } from './utils';

export class NetTableEditorProvider implements vscode.CustomTextEditorProvider {

    private static readonly viewType = 'dota2SimpleGUI.editNetTable';
    
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new NetTableEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(NetTableEditorProvider.viewType, provider);
        return providerRegistration;
    }

    private kvList: KeyValues3[];
    private request: RequestHelper;

    constructor( private readonly context: vscode.ExtensionContext ) {
        this.request = new RequestHelper();
        this.kvList = [];
    }

    /**
     * Find custom_net_tables in kvList
     */
    private getCustomNetTables(): KeyValues3 {
        if (this.kvList.length < 2) {
            return emptyKeyValues;
        }
        if (Array.isArray(this.kvList[1].Value)) {
            const tables = this.kvList[1].Value.find((v)=>v.Key === "custom_net_tables");
            if (tables) {
                return tables;
            }
            const newTable = NewKeyValuesArray("custom_net_tables", []);
            this.kvList[1].Value.push(newTable);
            return newTable;
        }
        return emptyKeyValues;
    }

    /**
     * Convert custom_net_tables to JSON stirng
     */
    private getTableListToJSON(): string {
        const kv = this.getCustomNetTables();
        if (kv === emptyKeyValues) {
            return "[]";
        }
        const list = [];
        if (kv.Type === KeyValues3Type.KeyValue_Array && Array.isArray(kv.Value)) {
            for(const child of kv.Value) {
                if (!Array.isArray(child.Value)) {
                    list.push(child.Value);
                }
            }
        }
        return JSON.stringify(list);
    }

    /**
     * When editor is opened
     * @param document 
     * @param webviewPanel 
     * @param _token 
     */
    public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = await this.getHTML(webviewPanel.webview);

        // send a text to webview
        const updateKeyValues = async () => {
            try {
                this.kvList = await loadFromString(document.getText());
            } catch(e) {
                vscode.window.showErrorMessage(e.toString() + "\n" + document.uri.fsPath);
            }
            webviewPanel.webview.postMessage({
                label: 'update',
                text: this.getTableListToJSON(),
            });
        };

        // Add a table name
        this.request.listenRequest("add-table", (...args: any[]) => {
            if (args.length <= 0) {
                return;
            }
            const name = args[0];
            const kv = this.getCustomNetTables();
            if (Array.isArray(kv.Value)) {
                kv.Value.push(NewKeyValue("", name));
            }
            writeDocument(document, formatKeyValues(this.kvList));
        });

        // Remove a table name
        this.request.listenRequest("remove-table", (...args: any[]) => {
            if (args.length <= 0) {
                return;
            }
            const name = args[0];
            const kv = this.getCustomNetTables();
            if (Array.isArray(kv.Value)) {
                kv.Value = kv.Value.filter((v) => v.Value !== name);
            }
            writeDocument(document, formatKeyValues(this.kvList));
        });

        // modify a table name
        this.request.listenRequest("modify-table", (...args: any[]) => {
            if (args.length < 2) {
                return;
            }
            const name = args[0];
            const newName = args[1];
            const kv = this.getCustomNetTables();
            if (Array.isArray(kv.Value)) {
                const child = kv.Value.find((v) => v.Value === name);
                if (child) {
                    child.Value = newName;
                }
            }
            writeDocument(document, formatKeyValues(this.kvList));
        });

        const onChangeDocument = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.contentChanges.length <= 0) {
                return;
            }
            if (e.document.uri.toString() === document.uri.toString()) {
                updateKeyValues();
            }
        });

        webviewPanel.onDidDispose(() => {
            onChangeDocument.dispose();
        });

        webviewPanel.webview.onDidReceiveMessage((ev: any) => {
            this.request.onRequest(ev, webviewPanel.webview);
        });

        // Initialize it if it is empty text
        if (document.getText().trim().length === 0) {
            initializeKV3ToDocument(document);
            return;
        }
        
        // Only support KeyValues3
        if (!document.lineAt(0).text.startsWith("<!--")) {
            vscode.window.showErrorMessage("This file isn't kv3 format.\n" + document.uri.fsPath);
            return;
        }

        updateKeyValues();
    }

    /**
     * Return HTML content
     * @param webview 
     */
    private async getHTML(webview: vscode.Webview): Promise<string> {

        const nonce = GetNonce();

        const styleUri = webview.asWebviewUri(vscode.Uri.file(
            path.join(this.context.extensionPath, 'media', 'nettable_editor.css')
        ));

        const scriptUri = webview.asWebviewUri(vscode.Uri.file(
            path.join(this.context.extensionPath, 'media', 'nettable_editor.js')
        ));

        const baseUri = webview.asWebviewUri(vscode.Uri.file(
            path.join(this.context.extensionPath, 'media')
        ));

        return `
            <!DOCTYPE html>
            <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                    <link href="${styleUri}" rel="stylesheet" />
                </head>
                <body>
                    <div id="editor">
                    </div>
                    <script nonce="${nonce}" src="${scriptUri}"></script>
                </body>
            </html>
        `;
    }
}