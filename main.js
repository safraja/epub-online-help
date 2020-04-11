/*
Copyright (c) 2020 Jakub Šafránek
*/

// Default location of a file to open, if it is not specified in URL. If left empty,
// app will ask user to upload local file or insert URL address of EPUB file.
const EPUB_DEFAULT_FILE = ""; ///epub/epub30-spec.epub
// Specifies, if app should (after CACHE TIME) check, if EPUB was not changed.
const EPUB_CHECK_UPDATE = true;
// Specifies, after how many seconds should app download file to check, if it was not changed.
const EPUB_CACHE_TIME = 604800;

window.db_name;
window.db = {};
window.epub_file;
window.secondary_epub_files = [];
window.readed_page;
window.page_hash;
window.epub_settings;

if (!window.indexedDB)
{
    window.alert("Je nám líto, váš prohlížeč nepodporuje stabilní verzi IndexDB, kterou tato aplikace vyžaduje.");
}

window.addEventListener('load', () =>
{
    Load_application();

    document.getElementById('file-upload-input').addEventListener('change', (event) =>
    {
        let files = event.target.files;
        if (files.length > 0)
        {
            window.db_name = 'LOCAL-FILE-' + files[0].name;
            Open_DB().then((result) =>
            {
                JSZip.loadAsync(files[0])
                    .then(function (zip)
                    {
                        return new Promise((resolve, reject) =>
                        {
                            document.getElementById('file-upload-div').style.display = 'none';
                            document.getElementById('epub-display').style.display = 'flex';
                            Process_inner_files(zip);
                            Add_listeners();
                        });
                    });
            });
        }
    });

    document.getElementById('confirm-file-addres-load').addEventListener('click', (event) =>
    {
        let file_addres = document.getElementById('file-addres-input').value;

        if (file_addres != "")
        {
            history.replaceState({"page": null}, null, `?file=${file_addres}`);
            Load_application();
        }
        else
        {
            alert('Nebyla vyplněna adreasa');
        }

    });

    document.getElementById('contact-tab').addEventListener('click', (event) =>
    {
        Display_tab('epub-display');
    });

    document.getElementById('settings-tab').addEventListener('click', (event) =>
    {
        Display_tab('settings-div');
    });
});

window.addEventListener('popstate', function (event)
{
    Change_page(event.state.page, "", true, event.state.file);
});

/**
 * Starting function, depending on URL parameters and the value of EPUB_DEFAULT_FILE constant either starts
 * loading of EPUB file or displays inputs for inserting local EPUB file or an URL adress.
 */
function Load_application()
{
    const url_params = new URL(location.href).searchParams;

    epub_file = url_params.get('file');
    secondary_epub_files = url_params.get('secondary_files');
    readed_page = url_params.get('readed_page');
    page_hash = url_params.get('hash');

    if (epub_file == null)
    {
        if (window.EPUB_DEFAULT_FILE != "")
        {
            epub_file = EPUB_DEFAULT_FILE;
            window.db_name = epub_file;
        }
    }
    else
    {
        window.db_name = epub_file;
    }

    if (window.db_name != "")
    {
        if (window.secondary_epub_files != null)
        {
            window.secondary_epub_files = window.secondary_epub_files.split(',');
            window.secondary_epub_files.unshift(window.db_name);
        }

        let databeses_to_load = [];

        if (window.secondary_epub_files != null)
        {
            for (let i = 0; i < window.secondary_epub_files.length; i++)
            {
                databeses_to_load.push(Open_DB(window.secondary_epub_files[i]));
            }
        }
        else
        {
            databeses_to_load.push(Open_DB())
        }

        console.log('databeses_to_load' + databeses_to_load);

        Promise.all(databeses_to_load).then((results) =>
        {
            console.log("databeses_to_load:", databeses_to_load);
            let secondary_epubs = [];

            for (let i = 1; i < results.length; i++)    // Start from 1 to ignore main EPUB file.
            {
                console.log("window.secondary_epub_files[i]:", window.secondary_epub_files[i]);
                secondary_epubs.push(Renew_DB_content(results[i], window.secondary_epub_files[i]));
            }
            console.log("secondary_epubs:", secondary_epubs);
            Promise.all(secondary_epubs).then(() =>
            {
                console.log("secondary_epubs2 :", secondary_epubs);
                if ((results[0] == true) && (EPUB_CHECK_UPDATE == true))
                {
                    console.log(`db_existed (${db_name})`, results[0]);
                    Read_from_DB('HTTP_HEADERS').then((result) =>
                    {
                        let old_headers = JSON.parse(result.file_content);

                        let http_req = new XMLHttpRequest();
                        http_req.open('HEAD', window.db_name);
                        http_req.onreadystatechange = function ()
                        {
                            if (this.readyState == this.DONE)
                            {
                                if (new Date(this.getResponseHeader('last-modified')) > new Date(old_headers['last-modified']))
                                {   // If the file on server were changed, clear DB and download process file from server.
                                    Clear_data_from_DB();
                                    Process_epub();
                                }
                                else
                                {   // Use saved files in DB.
                                    Read_from_DB('META-INF/container.xml').then((result) =>
                                    {
                                        return new Promise((resolve, reject) =>
                                        {
                                            let parser = new DOMParser();
                                            let xmlDoc = parser.parseFromString(result.file_content, "text/xml");

                                            let rootfile =
                                                xmlDoc.querySelector("container rootfiles rootfile").getAttribute("full-path");

                                            let rootfile_name = rootfile.substring(rootfile.lastIndexOf("/") + 1);
                                            sessionStorage.setItem("rootfile_dir", rootfile.replace(rootfile_name, ""));
                                            sessionStorage.setItem("rootfile_name", rootfile_name);

                                            resolve(rootfile)
                                        }).then(function (rootfile)
                                        {
                                            console.log('Načteno z historie.');
                                            Load_UI(rootfile);
                                            Add_listeners();
                                        });
                                    });
                                }
                            }
                        };
                        http_req.send();
                    });
                }
                else
                {
                    Process_epub();
                }
            });
        });
    }
    else    // No default file loaded.
    {
        document.getElementById('file-upload-div').style.display = 'flex';
        document.getElementById('epub-display').style.display = 'none';
    }
}

/**
 * Function used to check and eventually initialize actualizatin of database for secondary EPUB files.
 * Is not used for the main EPUB file.
 *
 * @param {boolean} db_existed - Information, wheter the DB already existed (EPUB was already loaded in the past) or is newly created.
 * @param {string} db_name - The name of the database, which should be checked.
 * @returns {Promise<void>} - Empty Promise.
 */
function Renew_DB_content(db_existed, db_name)
{
    return new Promise(async (resolve, reject) =>
    {
        console.log(`db_existed (${db_name})`, db_existed);

        if ((db_existed == true) && (EPUB_CHECK_UPDATE == true))
        {
            Read_from_DB('HTTP_HEADERS', db_name).then((result) =>
            {
                //console.log("Renew_DB_content2 :" , result);
                let old_headers = JSON.parse(result.file_content);

                let http_req = new XMLHttpRequest();
                http_req.open('HEAD', db_name);
                http_req.onreadystatechange = function ()
                {
                    if (this.readyState == this.DONE)
                    {
                        console.log("Renew_DB_content3 :", this);

                        if (new Date(this.getResponseHeader('last-modified')) > new Date(old_headers['last-modified']))
                        {   // If the file on server were changed, clear DB and download process file from server.
                            Clear_data_from_DB();
                            console.log("Renew_DB_content45 :", this);
                            Process_epub(db_name, false).then(() =>
                            {
                                console.log("Renew_DB_content5 :", this);
                                resolve();
                            });
                        }
                        else
                        {
                            resolve();
                        }
                    }
                };
                http_req.send();
            });
        }
        else
        {
            console.log("Renew_DB_content6 :", db_name);
            await Process_epub(db_name, false).then(() =>
            {
                console.log("Renew_DB_content 444444444444444 :", db_name);
                resolve();
                console.log("Renew_DB_content 77777777777777777777777777777777777 :", db_name);
            });
            resolve();
            console.log("Renew_DB_content asdasdsssssss :", db_name);
        }
    });
}

/**
 * Loads and extract an EPUB file.
 *
 * @param {string} [epub_file] - The name of the processed EPUB file. Set to main EPUB file name by default.
 * @param {boolean} [add_listeners] - Wheter to add event listeners after processing, used for the main EPUB file.
 * @returns {Promise<void>} - Empty Promise.
 */
function Process_epub(epub_file = "", add_listeners = true)
{
    return new Promise((resolve, reject) =>
    {
        if (epub_file == "")
        {
            epub_file = window.epub_file;
        }

        fetch(epub_file) // Fetch the url.
            .then(function (response)
            {
                if (response.status === 200 || response.status === 0)
                {
                    let headers = {};
                    for (let headers_data of response.headers.entries())
                    {
                        headers[headers_data[0]] = headers_data[1];
                    }
                    console.log("Save_file_to_DB(\"HTTP_HEADERS\")", epub_file);
                    Save_file_to_DB("HTTP_HEADERS", JSON.stringify(headers), epub_file);
                    return Promise.resolve(response.blob());
                }
                else
                {
                    return Promise.reject(new Error(response.statusText));  // Loading file error.
                }
            })
            .then(JSZip.loadAsync)  // Chain with the zip promise.
            .then(function (zip)
            {
                return new Promise(async (resolve, reject) =>
                {
                    await Process_inner_files(zip, epub_file);
                    console.log("ggggggggsssssssssssssssssggggggggggggggg");
                    resolve();
                });
            })
            .then(function ()
            {
                console.log("ggggggggggggggggggggggg", add_listeners);
                if (add_listeners == false)
                {
                    console.log("add_listenersssssssssfalse", add_listeners);
                    resolve();
                }
            })
            .catch((error) =>
            {
                console.error('Error:', error);
                alert('Je nám líto, soubor se nepodařilo stáhnout. Je pravděpodobně příliš velký, nebo' +
                    ' server neumožňuje jeho stažení přes Javasript.');
            });

        if (add_listeners == true)
        {
            console.log("asdads");
            Add_listeners();
        }
    });
}

/**
 * Calls Save_files_from_zip() all files in EPUB and then calls Load_UI(), if processed zip was the main EPUB.
 *
 * @param zip - Extracted zip (EPUB) data.
 * @param {string} db_name - The name of the database, which should be checked.  Set to main EPUB file name by default.
 * @returns {Promise<void>} - Empty Promise.
 */
async function Process_inner_files(zip, db_name = "")
{
    console.log("process inner db_name", db_name);
    await zip.file(`META-INF/container.xml`).async("string").then(function (content)
    {
        return new Promise((resolve, reject) =>
        {
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(content, "text/xml");

            let rootfile =
                xmlDoc.querySelector("container rootfiles rootfile").getAttribute("full-path");

            let rootfile_name = rootfile.substring(rootfile.lastIndexOf("/") + 1);
            sessionStorage.setItem("rootfile_dir", rootfile.replace(rootfile_name, ""));
            sessionStorage.setItem("rootfile_name", rootfile_name);

            resolve(rootfile)
        });
    })
        .then(function (rootfile)
        {
            return new Promise(async (resolve, reject) =>
            {
                await Save_files_from_zip(zip, db_name);
                resolve(rootfile);
            });
        })
        .then(function (rootfile)
        {
            if (db_name == "" || db_name == window.db_name)  // Only if processed file is the main EPUB.
            {
                console.log("asdasdasdasdasdasdasdasdads");
                Load_UI(rootfile);
            }
        });
}

/**
 * Saves all extracted files from EPUB to database. Determines the form of saved data based on file extension.
 *
 * @param zip - Extracted zip (EPUB) data.
 * @param {string} db_name - The name of the database, which should be checked.  Set to main EPUB file name by default.
 * @returns {Promise<void>} - Empty Promise.
 */
async function Save_files_from_zip(zip, db_name = "")
{
    async function Load_file_content(file, type)
    {
        await file[1].async(type).then(function (content)
        {
            Save_file_to_DB(file[0], content, db_name);
        });
    }

    for (const element of Object.entries(zip["files"]))
    {
        if (element[0].endsWith(".jpg") || element[0].endsWith(".jpeg")
            || element[0].endsWith(".png") || element[0].endsWith(".gif")
            || element[0].endsWith(".webp") || element[0].endsWith(".mp3")
            || element[0].endsWith(".mpeg"))
        {
            await Load_file_content(element, "base64");
        }
        else if (element[0].endsWith(".webm") || element[0].endsWith(".mp4"))
        {
            await Load_file_content(element, "blob");
        }
        else
        {
            await Load_file_content(element, "string");
        }
    }
}

/**
 *  Add event listeners related to the loaded EPUB file, for example to the next and previou control buttons.
 */
function Add_listeners()
{
    document.getElementById("next").addEventListener("click", () =>
    {
        let loaded_page = document.getElementById("page-name");

        let loaded_page_name = loaded_page.textContent;

        Read_from_DB(sessionStorage.getItem("rootfile_dir") +
            sessionStorage.getItem("rootfile_name")).then((result) =>
        {
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(result.file_content, "text/xml");

            loaded_page_name = loaded_page_name.replace(sessionStorage.getItem("rootfile_dir"), "");
            let lp_id = xmlDoc.querySelector(`[href='${loaded_page_name}']`).getAttribute("id");
            console.log(lp_id);
            let np_id = xmlDoc.querySelector(`[idref='${lp_id}']`).nextElementSibling.getAttribute("idref");
            console.log(np_id);
            let np_href = xmlDoc.getElementById(np_id).getAttribute("href");
            console.log(np_href);

            loaded_page.textContent = sessionStorage.getItem("rootfile_dir") + np_href;

            Change_page(np_href, sessionStorage.getItem("rootfile_dir") + sessionStorage.getItem("rootfile_name"));
        });
    });

    document.getElementById("prev").addEventListener("click", () =>
    {
        let loaded_page = document.getElementById("page-name");

        let loaded_page_name = loaded_page.textContent;

        Read_from_DB(sessionStorage.getItem("rootfile_dir") +
            sessionStorage.getItem("rootfile_name")).then((result) =>
        {
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(result.file_content, "text/xml");

            loaded_page_name = loaded_page_name.replace(sessionStorage.getItem("rootfile_dir"), "");
            let lp_id = xmlDoc.querySelector(`[href='${loaded_page_name}']`).getAttribute("id");
            console.log(lp_id);
            let pp_id = xmlDoc.querySelector(`[idref='${lp_id}']`).previousElementSibling.getAttribute("idref");
            console.log(pp_id);
            let pp_href = xmlDoc.getElementById(pp_id).getAttribute("href");
            console.log(pp_href);

            loaded_page.textContent = sessionStorage.getItem("rootfile_dir") + pp_href;

            Change_page(pp_href, sessionStorage.getItem("rootfile_dir") + sessionStorage.getItem("rootfile_name"));
        });
    });

    document.getElementById("epub-display").addEventListener("load", () =>
    {
        document.getElementById("epub-display").contentDocument.addEventListener('click', function (event)
        {
            if (event.target.matches(`a[href]`))
            {
                let test_string = event.target.getAttribute("href").toLowerCase();
                if (!test_string.includes("https://") && !test_string.includes("http://")) // If link is not external.
                {
                    event.preventDefault();
                    Change_page(event.target.getAttribute("href"));
                }
            }
        });

        document.getElementById("epub-display").contentDocument.querySelectorAll('pre code').forEach((block) =>
        {
            hljs.highlightBlock(block);
        });

        let videos = document.getElementById("epub-display").contentDocument.querySelectorAll(`video`);

        for (let video of videos)
        {
            let source = video.querySelector('source');

            let test_string = source.getAttribute("src").toLowerCase();
            if (!test_string.includes("https") && !test_string.includes("http")) // If link is not external.
            {
                let changed_string = test_string.replace("../", "");    //  TO DO
                changed_string = changed_string.replace("./", "");

                Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${changed_string}`).then((result) =>
                {
                    video.src = window.URL.createObjectURL(result.file_content);
                });
            }
        }

        if (sessionStorage.getItem("cur_hash") != "")
        {
            let focused = document.getElementById("epub-display").contentDocument.body.querySelector(sessionStorage.getItem("cur_hash"));
            if (focused != null)
            {
                focused.scrollIntoView(true);
            }
        }
    });
}

/**
 * Load user interface of application based on main EPUB data.
 *
 * @param {string} rootfile - Rootfile name of the main EPUB file.
 * @returns {Promise<void>} - Empty Promise.
 */
function Load_UI(rootfile)
{
    return new Promise(() =>
    {
        if (page_hash != null)
        {
            sessionStorage.setItem("cur_hash", `#${page_hash}`);
        }

        let parser = new DOMParser();
        Read_from_DB(rootfile).then((rootfile_content) =>
        {
            let xml_doc = parser.parseFromString(rootfile_content.file_content, "text/xml");

            let documents_el = xml_doc.querySelectorAll(`manifest item`);
            let document_types = {};

            for (let doc of documents_el)
            {
                document_types[`${sessionStorage.getItem("rootfile_dir")}${doc.getAttribute("href")}`] =
                    doc.getAttribute("media-type");
            }

            sessionStorage.setItem("document_types", JSON.stringify(document_types));

            let epub_version = parseFloat(xml_doc.querySelector(`package`).getAttribute('version'));
            if (epub_version < 3)
            {
                alert('Varování, načítaný EPUB není ve verzi 3, některé funkce nemusí správně fungovat.');
            }

            let alt_lang_el = xml_doc.querySelectorAll('link[rel="alternate"][media-type="application/epub+zip"]');
            if (alt_lang_el.length > 0)
            {
                let main_language = xml_doc.getElementsByTagName('dc:language')[0].textContent.toUpperCase();

                let active_lang = document.querySelector('#language-select .active');
                active_lang.textContent = main_language;
                active_lang.addEventListener('click', (event) =>
                {
                    document.querySelector('#language-select .open').style.display = 'block';

                    let funct = function (event)
                    {
                        if (!(document.querySelector('#language-select').contains(event.target)))  //pokud není kliknuto do menu
                        {
                            document.querySelector('#language-select .open').style.display = 'none';
                            document.removeEventListener('click', funct);
                        }
                    };

                    document.body.addEventListener('click', funct);
                });

                let lang_list = document.querySelector('#language-select .open ul');
                let li = document.createElement('li');
                li.textContent = main_language;
                li.addEventListener('click', (event) =>
                {
                    document.querySelector('#language-select .open').style.display = 'none';
                });
                lang_list.appendChild(li);

                for (let lang of alt_lang_el)
                {
                    li = document.createElement('li');
                    let a = document.createElement('a');
                    a.textContent = lang.getAttribute('xml:lang').toUpperCase();
                    a.setAttribute('href', lang.getAttribute('href'));
                    li.appendChild(a);
                    lang_list.appendChild(li);
                }
            }
            else
            {
                document.getElementById('language-select').style.display = 'none';
            }

            let settings_link = xml_doc.querySelector(`[rel='help:settings']`);
            if (settings_link != null)
            {
                let settings_href = settings_link.getAttribute('href');
                Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${settings_href}`)
                    .then((result) =>
                    {
                        Generate_settings_page(result);
                        let settings = {};

                        let properties = JSON.parse(result.file_content).properties;

                        Object.keys(properties).forEach((key) =>
                        {
                            settings[key] = properties[key]['default'];
                        });

                        window.epub_settings = settings;

                        Finalize_load_UI(rootfile_content, xml_doc);
                    });
            }
            else
            {
                Finalize_load_UI(rootfile_content, xml_doc);
            }
        });
    });
}

/**
 * Finalizes loadin of user interface, then calls Load_side_menu().
 *
 * @param {JSON} rootfile_content - Rootfile loaded with Read_from_DB() function.
 * @param {Document} xml_doc - Parsed rootfile content.
 */
function Finalize_load_UI(rootfile_content, xml_doc)
{
    if (readed_page == null)
    {
        let first_page_id = xml_doc.querySelector(`itemref`).getAttribute("idref");
        let first_page_href = xml_doc.getElementById(first_page_id).getAttribute("href");
        document.getElementById("page-name").textContent =
            `${sessionStorage.getItem("rootfile_dir")}${first_page_href}`;

        Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${first_page_href}`)
            .then((result) =>
            {
                Adjust_content(result.file_content).then((result) =>
                {
                    document.getElementById("page-name").textContent =
                        `${sessionStorage.getItem("rootfile_dir")}${first_page_href}`;
                    document.querySelector('#epub-display').srcdoc = result;
                    sessionStorage.setItem("cur_file",
                        `${sessionStorage.getItem("rootfile_dir")}${first_page_href}`);

                    Load_side_menu(rootfile_content);
                });
            });
    }
    else
    {
        Read_from_DB(readed_page).then((result) =>
        {
            if (result == null)
            {
                window.alert("Omlouváme se, požadovaná stránka nápovědy nebyla nalezena.");
            }
            else
            {
                Adjust_content(result.file_content).then((result) =>
                {
                    document.getElementById("page-name").textContent = readed_page;
                    document.querySelector('#epub-display').srcdoc = result;
                    sessionStorage.setItem("cur_file", readed_page);

                    Load_side_menu(rootfile_content);
                });
            }
        });
    }
}

/**
 * Load side menu based on data of the main EPUB file.
 *
 * @param {Object} rootfile_content - Rootfile loaded with Read_from_DB() function.
 */
function Load_side_menu(rootfile_data)
{
    let parser = new DOMParser();
    let xml_doc = parser.parseFromString(rootfile_data.file_content, "text/xml");
    let element = xml_doc.querySelector('item[properties="nav"]');

    if (element != null)
    {
        let href = element.getAttribute('href');
        sessionStorage.setItem('nav_dir', href.replace(href.substr(href.lastIndexOf("/") + 1), ''));
        href = sessionStorage.getItem("rootfile_dir") + href;

        let pom = new URL("", `https://${document.domain}`).href;

        pom = new URL(href, pom);
        href = pom.pathname.substring(1);

        Read_from_DB(href).then(async (result) =>
        {
            let parser = new DOMParser();
            let xml_doc = parser.parseFromString(result.file_content, "text/xml");
            let generated_nav = document.createElement('ul');

            let original_nav = xml_doc.querySelector('nav[*|type="toc"] ol');

            if (window.secondary_epub_files != null)
            {
                console.log("window.secondary_epub_files", window.secondary_epub_files);
                for (let i = 1; i < window.secondary_epub_files.length; i++)
                {
                    await Read_from_DB('META-INF/container.xml', window.secondary_epub_files[i]).then(
                        async (result) =>
                        {
                            return new Promise((resolve, reject) =>
                            {
                                console.log("Read_from_DB", result);
                                let parser = new DOMParser();
                                let xmlDoc = parser.parseFromString(result.file_content, "text/xml");

                                let rootfile =
                                    xmlDoc.querySelector("container rootfiles rootfile").getAttribute("full-path");

                                let rootfile_name = rootfile.substring(rootfile.lastIndexOf("/") + 1);
                                let rootfile_dir = rootfile.replace(rootfile_name, "");

                                console.log("root", rootfile);

                                resolve({"rootfile": rootfile, "rootfile_dir": rootfile_dir})
                            }).then(function (rootfile_data)
                            {
                                Read_from_DB(rootfile_data.rootfile, window.secondary_epub_files[i]).then(
                                    async (rootfile_content) =>
                                    {
                                        console.log("sec", window.secondary_epub_files[i]);
                                        console.log("rootfile_content");
                                        let parser = new DOMParser();
                                        let xml_doc = parser.parseFromString(rootfile_content.file_content, "text/xml");
                                        let element = xml_doc.querySelector('item[properties="nav"]');

                                        if (element != null)
                                        {
                                            let href = element.getAttribute('href');

                                            href = rootfile_data.rootfile_dir + href;

                                            let pom = new URL("", `https://${document.domain}`).href;

                                            pom = new URL(href, pom);
                                            href = pom.pathname.substring(1);
                                            console.log("href", href);

                                            await Read_from_DB(href, window.secondary_epub_files[i]).then(async (result) =>
                                            {
                                                let parser = new DOMParser();
                                                console.log("window.secondary_epub_files[i]", window.secondary_epub_files[i])
                                                let xml_doc = parser.parseFromString(result.file_content, "text/xml");

                                                let original_nav = xml_doc.querySelector('nav[*|type="toc"] ol');

                                                let generated_children = Generate_submenu(original_nav.children,
                                                    window.secondary_epub_files[i]);

                                                let file_li = document.createElement("li");
                                                let details = document.createElement("details");
                                                let summary = document.createElement("summary");
                                                let span = document.createElement("span");
                                                span.textContent = window.secondary_epub_files[i];
                                                span.classList.add("nav-link");

                                                summary.appendChild(span);
                                                details.appendChild(summary);

                                                let file_ul = document.createElement("ul");
                                                file_ul.append(...generated_children);
                                                details.appendChild(file_ul);

                                                file_li.appendChild(details);
                                                generated_nav.append(file_li);
                                            });
                                        }
                                    });

                            });
                        })
                }

                let file_li = document.createElement("li");
                let details = document.createElement("details");
                details.open = true;
                let summary = document.createElement("summary");
                let span = document.createElement("span");
                span.textContent = window.db_name;
                span.classList.add("nav-link");

                summary.appendChild(span);
                details.appendChild(summary);

                let file_ul = document.createElement("ul");
                let generated_children = Generate_submenu(original_nav.children, window.db_name);
                file_ul.append(...generated_children);
                details.appendChild(file_ul);

                file_li.appendChild(details);
                generated_nav.append(file_li);
            }
            else
            {
                let generated_children = Generate_submenu(original_nav.children, window.db_name);
                generated_nav.append(...generated_children);
            }

            document.getElementById('main-navigation').appendChild(generated_nav);


            let selector;
            let selector_file = sessionStorage.getItem("cur_file").replace(sessionStorage.getItem("rootfile_dir"), "");
            selector_file = selector_file.replace(sessionStorage.getItem('nav_dir'), "");

            selector = `[data-href*='${selector_file}`;
            let hash = new URL(location.href).searchParams.get('hash');

            if (hash != null)
            {
                selector += `#${hash}']`;
            }
            else
            {
                selector += `']`;
            }

            let menu_spans = document.querySelectorAll('#main-navigation .highlited');
            for (let menu_span of menu_spans)
            {
                menu_span.classList.remove('highlited');
            }
            Highlight_menu_path(document.querySelector(selector));
        });

        element = xml_doc.querySelector('item[properties="contact"]');
        href = element.getAttribute('href');
        document.getElementById('contact-tab').addEventListener('click', () =>
        {
            Change_page(href, sessionStorage.getItem("rootfile_dir") + sessionStorage.getItem("rootfile_name"));
        });
    }
}

/**
 * Recursive function for generation of one level of navigation.
 *
 * @param {Element} navigation - UL element from which should be navigation generateg.
 * @param {string} epub_file - Name of EPUB file the navigation is generated for.
 * @returns {[]} - Array of navigation elements.
 */
function Generate_submenu(navigation, epub_file)
{
    let generated_children = [];

    for (let li of navigation)
    {
        let generated_li = document.createElement('li');

        if (li.children.length == 2) // If LI has submenu.
        {
            let details = document.createElement('details');
            let summary = document.createElement('summary');

            let span = document.createElement('span');
            span.textContent = li.children[0].textContent;

            if (li.children[0].tagName.toLowerCase() == 'a')    // If span contains link.
            {
                span.addEventListener('click', () =>
                {
                    Change_page(li.children[0].getAttribute("href"), "cur_posittion",
                        false, epub_file);
                });
                span.classList.add('nav-link');
                span.setAttribute('data-href', li.children[0].getAttribute("href"));
                span.setAttribute('data-file', epub_file);
            }
            else
            {
                span.classList.add('nav-heading');
            }
            summary.appendChild(span);
            details.appendChild(summary);

            let ul = document.createElement('ul');
            let details_ul = Generate_submenu(li.children[1].children, epub_file);
            ul.append(...details_ul);

            details.appendChild(ul);

            generated_li.appendChild(details);
        }
        else
        {
            let span = document.createElement('span');
            span.textContent = li.children[0].textContent;
            span.classList.add('nav-link');

            if (li.children[0].tagName.toLowerCase() == 'a')
            {
                span.addEventListener('click', () =>
                {
                    Change_page(li.children[0].getAttribute("href"), "cur_posittion", false, epub_file);
                });
                span.setAttribute('data-href', li.children[0].getAttribute("href"));
                span.setAttribute('data-file', epub_file);
            }

            generated_li.appendChild(span);
        }

        generated_children.push(generated_li);
    }

    return generated_children;
}

/**
 * Change displayed document in iframe. Also handles history records.
 *
 * @param {string} new_page - Name of the new documet.
 * @param {string} doc_path - Path related to the document.
 * @param {boolean} from_history - Shether the change was iniciated by popstate event (if true, history is not affected).
 * @param {string} new_file - The name of the database from which should be readed. Set to main EPUB file name by default.
 */
function Change_page(new_page, doc_path = "cur_posittion", from_history = false, new_file = "")
{
    let pom;

    if (doc_path == "cur_posittion")
    {
        pom = new URL(sessionStorage.getItem("cur_file"), `https://${document.domain}`).href;
    }
    else
    {
        pom = new URL(doc_path, `https://${document.domain}`).href;
    }

    pom = new URL(new_page, pom);
    new_page = pom.pathname.substring(1);

    sessionStorage.setItem("cur_hash", pom.hash);

    let search_param = [];

    const url_params = new URL(location.href).searchParams;
    if (new_file != "" && window.db_name != new_file && window.secondary_epub_files.length > 0)
    {
        search_param.push(`file=${new_file}`);

        let sec_files_par = window.secondary_epub_files;

        for (let i = 0; i < sec_files_par.length; i++)
        {
            if (sec_files_par[i] == new_file || sec_files_par[i] == window.db_name)
            {
                sec_files_par.splice(i);
            }
        }

        search_param.push(`readed_page=${new_page}`);

        sec_files_par.unshift(window.db_name);
        search_param.push(`secondary_files=${sec_files_par.join(',')}`);
        sec_files_par.push(new_file);
        window.secondary_epub_file = sec_files_par;

        window.db_name = new_file;

        if (pom.hash != "")
        {
            search_param.push(`hash=${pom.hash.substring(1)}`);
        }
    }
    else
    {
        if (url_params.get('file') != null)
        {
            search_param.push(`file=${url_params.get('file')}`);
        }
        search_param.push(`readed_page=${new_page}`);
        if (url_params.get('secondary_files') != null)
        {
            search_param.push(`secondary_files=${url_params.get('secondary_files')}`);
        }
        if (pom.hash != "")
        {
            search_param.push(`hash=${pom.hash.substring(1)}`);
        }
    }


    if (from_history == false)
    {
        history.pushState({"page": new_page + pom.hash, "file": new_file}, null, `?${search_param.join("&")}`);
    }

    let loaded_page = document.getElementById("page-name");
    loaded_page.textContent = new_page.replace(sessionStorage.getItem("rootfile_dir"), "");
    sessionStorage.setItem("cur_file", new_page);

    let selector;
    let selector_file = new_page.replace(sessionStorage.getItem("rootfile_dir"), "");
    selector_file = selector_file.replace(sessionStorage.getItem('nav_dir'), "");

    selector = `[data-href*='${selector_file}`;
    let hash = new URL(location.href).searchParams.get('hash');

    if (hash != null)
    {
        selector += `#${hash}']`;
    }
    else
    {
        selector += `']`;
    }

    let menu_spans = document.querySelectorAll('#main-navigation .highlited');
    for (let menu_span of menu_spans)
    {
        menu_span.classList.remove('highlited');
    }
    Highlight_menu_path(document.querySelector(selector));

    Read_from_DB(new_page).then((result) =>
    {
        if (result == null)
        {
            window.alert("Omlouváme se, požadovaná stránka nápovědy nebyla nalezena.");
        }
        else
        {
            Adjust_content(result.file_content).then((result) =>
            {
                document.querySelector('#epub-display').srcdoc = result;
                Display_tab('epub-display');    // Ensure that iframe is displayed.
            })
        }
    });
}

/**
 * Highlight path to the displayed document in navigation.
 *
 * @param {Element} menu_link - Element to highlite.
 */
function Highlight_menu_path(menu_link)
{
    if (menu_link != null)
    {
        menu_link.classList.add('highlited');
        let details = menu_link.closest('details');
        if (details != null)
        {
            details.open = true;
            let span = details.querySelector('summary span');
            span.classList.add('highlited');
            Highlight_menu_path(details.parentElement);
        }
    }
}

/**
 * Function for adjusting HTML document. Transforms links based on their type (mainly to Base64) and evaluates
 * users settings.
 *
 * @param {string} html - HTML document to adjust.
 * @returns {Promise<string>} - Adjustit HTML document.
 */
function Adjust_content(html)
{
    return new Promise(async (resolve, reject) =>
    {
        var parser = new DOMParser();
        var xml_doc = parser.parseFromString(html, "text/xml");
        var href_el = xml_doc.querySelectorAll(`link[href]`);

        let changed_string = "";


        for (let cur_el of href_el)
        {
            let test_string = cur_el.getAttribute("href").toLowerCase();
            if (!test_string.includes("https") && !test_string.includes("http")) // If link is not external.
            {
                changed_string = cur_el.getAttribute("href").replace("../", "");    //  TO DO
                changed_string = changed_string.replace("./", "");

                cur_el.setAttribute("href", `data:text/css;base64,`);

                await Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${changed_string}`).then(async (result) =>
                {
                    var blob = new Blob(
                        [result.file_content],
                        {type: 'text/css'}
                    );
                    await Get_base64(blob).then((result) =>
                    {
                        cur_el.setAttribute("href", result);
                    })
                });
            }
        }

        href_el = xml_doc.querySelectorAll(`a[href]`);

        for (let cur_el of href_el)
        {
            let test_string = cur_el.getAttribute("href").toLowerCase();
            if (test_string.includes("https://") || test_string.includes("http://")) // If link is external.
            {
                cur_el.setAttribute("target", "_blank");
            }
        }

        href_el = xml_doc.querySelectorAll(`img[src]`);

        for (let cur_el of href_el)
        {
            let test_string = cur_el.getAttribute("src").toLowerCase();
            if (!test_string.includes("https") && !test_string.includes("http")) // If link is not external.
            {
                changed_string = cur_el.getAttribute("src").replace("../", "");    //  TO DO
                changed_string = changed_string.replace("./", "");

                await Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${changed_string}`).then((result) =>
                {
                    cur_el.setAttribute("src", `data:image/*;base64,${result.file_content}`);
                });
            }
        }

        href_el = xml_doc.querySelectorAll(`audio[src]`);

        for (let cur_el of href_el)
        {
            let test_string = cur_el.getAttribute("src").toLowerCase();
            if (!test_string.includes("https") && !test_string.includes("http")) // If link is not external.
            {
                changed_string = cur_el.getAttribute("src").replace("../", "");    //  TO DO
                changed_string = changed_string.replace("./", "");

                console.log(`${sessionStorage.getItem("rootfile_dir")}${changed_string}`);
                await Read_from_DB(`${sessionStorage.getItem("rootfile_dir")}${changed_string}`).then((result) =>
                {
                    cur_el.setAttribute("src", `data:audio/*;base64,${result.file_content}`);
                });
            }
        }

        href_el = xml_doc.querySelectorAll(`svg image`);

        for (let cur_el of href_el)
        {
            let href;

            if (cur_el.getAttribute("href") != null)
            {
                href = cur_el.getAttribute("href");
            }
            else
            {
                href = cur_el.getAttribute("xlink:href");
            }

            let test_string = href.toLowerCase();

            if (!test_string.includes("https") && !test_string.includes("http")) // If link is not external.
            {
                changed_string = href.replace("../", "");    //  TO DO
                changed_string = changed_string.replace("./", "");
                console.log("asdad " + sessionStorage.getItem(changed_string));
                cur_el.removeAttribute("xlink:href");
                await Read_from_DB(`${changed_string}`).then((result) =>
                {
                    cur_el.setAttribute("href", `data:image/*;base64,${result.file_content}`);
                });
            }
        }

        let ifs = xml_doc.querySelectorAll(`[epub-if]`);

        for (let element of ifs)
        {
            let condition = element.getAttribute('epub-if');
            if (condition.search('==') === -1) // If there is only variable.
            {
                if (window.epub_settings[condition] === false)
                {
                    element.style.display = 'none';
                }
                element.removeAttribute('epub-if');
            }
            else
            {
                condition = condition.replace('===', '==');
                let parts = condition.split('==');
                let pom;

                if (parts[0].search(/'|"|`/) == -1)  // If parts[0] is a variable.
                {
                    pom = (window.epub_settings[parts[0]] == parts[1].replace(/'|"|`/g, ''));
                }
                else
                {
                    pom = (window.epub_settings[parts[1]] == parts[0].replace(/'|"|`/g, ''));
                }

                if (pom == false)
                {
                    element.style.display = 'none';
                }
                element.removeAttribute('epub-if');

            }
        }

        let higl_style_link = document.createElement("link");
        higl_style_link.href = "highlightjs/default.css";
        higl_style_link.rel = "stylesheet";
        higl_style_link.type = "text/css";

        xml_doc.querySelector('head').appendChild(higl_style_link); // Add link to highlight style.

        var oSerializer = new XMLSerializer();
        resolve(oSerializer.serializeToString(xml_doc));
    });
}

/**
 * Initiate search of a new expression and write results.
 */
function Find_and_write_search_results()
{
    let expression = document.getElementById('search-input').value;
    let search_res = document.getElementById('search-results');
    search_res.textContent = "";

    Search_expression(expression).then((results) =>
    {
        results = results.sort(function (a, b)  // Order by priority.
        {
            return a.priority - b.priority;
        });

        let ul = document.createElement("ul");

        for (let result of results)
        {
            let li = document.createElement("li");
            let div = document.createElement("div");
            let h2 = document.createElement("h2");
            let info_div = document.createElement("div");

            h2.textContent = result.title;
            h2.addEventListener('click', () =>
            {
                Change_page(result.key, "", false, result.file);
            });
            div.appendChild(h2);
            info_div.textContent = results.description;
            div.appendChild(info_div);
            li.appendChild(div);
            ul.appendChild(li);
        }

        search_res.appendChild(ul);
    });
}

/**
 * Find searched expression in all documents.
 *
 * @param {string} expression - Searched expression.
 * @returns {Promise<[]>} - Array of objects with results generated by Generate_search_result().
 */
async function Search_expression(expression)
{
    return new Promise(async (resolve, reject) =>
    {
        Display_tab("search-div");

        let search_results = [];

        async function Search_in_document(key, db_name)
        {
            await Read_from_DB(key, db_name).then((result) =>
            {
                let parser = new DOMParser();
                let xml_doc = parser.parseFromString(result.file_content, "text/xml");

                let keywords = xml_doc.evaluate('//h:meta[@name="keywords"]/@content', xml_doc, ns_resolve,
                    XPathResult.STRING_TYPE, null).stringValue;

                if (keywords.search(RegExp(expression, 'i')) > -1)
                {
                    search_results.push(Generate_search_result(key, 1, xml_doc, db_name, ns_resolve));
                    return;
                }

                if (xml_doc.evaluate(`count(//h1[contains(text(),'${expression}')]|` +
                    `//h2[contains(text(),'${expression}')]|//h3[contains(text(),'${expression}')])`,
                    xml_doc, ns_resolve, XPathResult.NUMBER_TYPE, null).numberValue > 0)
                {
                    search_results.push(Generate_search_result(key, 2, xml_doc, db_name, ns_resolve));
                    return;
                }

                if (xml_doc.evaluate(`count(//*[contains(text(),'${expression}')])`,
                    xml_doc, ns_resolve, XPathResult.NUMBER_TYPE, null).numberValue > 0)
                {
                    search_results.push(Generate_search_result(key, 3, xml_doc, db_name, ns_resolve));
                    return;
                }
            });
        }

        let document_types = JSON.parse(sessionStorage.getItem("document_types"));

        let ns_resolve = function (prefix)
        {
            var ns = {'h': 'http://www.w3.org/1999/xhtml'};
            return ns[prefix] || null;
        };

        let documents_to_parse = [];

        Object.keys(document_types).forEach((key) =>
        {
            if (document_types[key] == "application/xhtml+xml")
            {
                documents_to_parse.push(key);
            }
        });

        for (let parsed_doc of documents_to_parse)
        {
            await Search_in_document(parsed_doc);
        }

        if (window.secondary_epub_files != null)
        {
            console.log("window.seconda_search", window.secondary_epub_files);
            for (let i = 1; i < window.secondary_epub_files.length; i++)
            {
                await Read_from_DB('META-INF/container.xml', window.secondary_epub_files[i]).then(
                    async (result) =>
                    {
                        return new Promise((resolve, reject) =>
                        {
                            console.log("searchRead_from_DB", result);
                            let parser = new DOMParser();
                            let xmlDoc = parser.parseFromString(result.file_content, "text/xml");

                            let rootfile =
                                xmlDoc.querySelector("container rootfiles rootfile").getAttribute("full-path");

                            let rootfile_name = rootfile.substring(rootfile.lastIndexOf("/") + 1);
                            let rootfile_dir = rootfile.replace(rootfile_name, "");

                            console.log("root", rootfile);

                            resolve({"rootfile": rootfile, "rootfile_dir": rootfile_dir})
                        }).then(async function (rootfile_data)
                        {
                            await Read_from_DB(rootfile_data.rootfile, window.secondary_epub_files[i]).then(
                                async (rootfile_content) =>
                                {
                                    console.log("sec", window.secondary_epub_files[i]);
                                    console.log("rootfile_content");

                                    let parser = new DOMParser();
                                    console.log("windowsss.secondary_epub_files[i]", window.secondary_epub_files[i])
                                    let xml_doc = parser.parseFromString(rootfile_content.file_content, "text/xml");

                                    let documents_el = xml_doc.querySelectorAll(`manifest item`);
                                    let document_types = {};

                                    for (let doc of documents_el)
                                    {
                                        let href = doc.getAttribute('href');

                                        href = rootfile_data.rootfile_dir + href;

                                        let pom = new URL("", `https://${document.domain}`).href;

                                        pom = new URL(href, pom);
                                        href = pom.pathname.substring(1);

                                        document_types[href] = doc.getAttribute("media-type");
                                    }

                                    let documents_to_parse = [];

                                    Object.keys(document_types).forEach((key) =>
                                    {
                                        console.log("ssssss", document_types[key] == "application/xhtml+xml");
                                        if (document_types[key] == "application/xhtml+xml")
                                        {
                                            documents_to_parse.push(key);
                                        }
                                    });

                                    for (let parsed_doc of documents_to_parse)
                                    {
                                        console.log("J=é===========ééééé");
                                        await Search_in_document(parsed_doc, window.secondary_epub_files[i]);
                                    }

                                });

                        });
                    })
            }
        }
        console.log("end search_results", search_results);
        resolve(search_results);
    });
}

/**
 *  Process search result into object.
 *
 * @param {string} key - Name of find document.
 * @param {number} priority - Priority of search.
 * @param {Document} xml_doc - Parsed document content.
 * @param {string} file - Name of EPUB file the find document belongs to.
 * @param {XPathNSResolver} ns_resolve - Resolver of namespaces for xml_doc.
 * @returns {Object} - Generated search result.
 */
function Generate_search_result(key, priority, xml_doc, file, ns_resolve)
{
    let title = xml_doc.evaluate('//h:title/text()', xml_doc, ns_resolve, XPathResult.STRING_TYPE,
        null).stringValue;
    let desc = xml_doc.evaluate('//h:meta[@name="description"]/@content', xml_doc, ns_resolve,
        XPathResult.STRING_TYPE, null).stringValue;
    return {"key": key, "priority": priority, "title": title, "description": desc, "file": file};
}

/**
 * Open indexedDB database with specified name or create a new one if does not exists.
 *
 * @param {string} [db_name] - The name of the database.
 * @returns {Promise<boolean>} - Returns true, if database existed, false if it was newly created.
 */
function Open_DB(db_name = "")
{
    return new Promise(async (resolve, reject) =>
    {
        console.log("Openning db " + db_name);
        if (db_name == "")
        {
            db_name = window.db_name;
        }
        let request = indexedDB.open(db_name, 3);

        let existed = true;

        request.onsuccess = async function (evt)
        {
            db[db_name] = request.result;
            console.log("Open success: " + db[db_name]);
            resolve(existed)
        };

        request.onerror = function (evt)
        {
            console.error("openDb:", evt.target.errorCode);
        };

        request.onupgradeneeded = function (evt)
        {
            console.log("openDb.onupgradeneeded");
            existed = false;
            let store = evt.currentTarget.result.createObjectStore('files', {keyPath: 'file_name'});
            try
            {
                Clear_data_from_DB();
            }
            catch (e)
            {
                console.log('Nic ke smazání.');
            }

        };
    });
}

/**
 * Convert name and content of a file to JSON and save it to database.
 *
 * @param {string} file_name - Name of saved file.
 * @param file_content - Content to save.
 * @param {string} [db_name] - The name of the database in which should be the file saved.
 */
function Save_file_to_DB(file_name, file_content, db_name = '')
{
    Save_to_DB({"file_name": file_name, "file_content": file_content}, db_name);
}

/**
 * Save object to database.
 *
 * @param data - Data to save.
 * @param {string} [db_name] - The name of the database in which should be the file saved. Set to main EPUB file name by default.
 */
function Save_to_DB(data, db_name = '')
{
    if (db_name == "")
    {
        db_name = window.db_name;
    }
    let request = db[db_name].transaction('files', 'readwrite').objectStore('files').add(data);

    request.onsuccess = function (event)
    {
        console.log("Záznam uložen");
    };

    request.onerror = function (event)
    {
        console.log("Záznam už existuje.");
    }
}

/**
 * Read data from database.
 *
 * @param key - Key of readed database record.
 * @param {string} db_name - The name of the database from which should be readed. Set to main EPUB file name by default.
 * @returns {Promise<JSON>} - Data loaded drom database, null on failure.
 */
function Read_from_DB(key, db_name = "")
{
    return new Promise(async (resolve, reject) =>
    {
        if (db_name == "")
        {
            db_name = window.db_name
        }
        let transaction = db[db_name].transaction("files");
        let request = transaction.objectStore("files").get(key);

        request.onerror = function (event)
        {
            alert("Nebylo možné načíst data.");
        };

        request.onsuccess = async function (event)
        {
            if (request.result)
            {
                resolve(request.result);
            }
            else
            {
                resolve(null);  // Data not found.
            }
        };
    });
}

/**
 * Deletes all data from database.
 *
 * @param {string} db_name - The name of the database, which should be cleared. Set to main EPUB file name by default.
 */
function Clear_data_from_DB(db_name = "")
{
    if (db_name == "")
    {
        db_name = window.db_name;
    }
    let transaction = db[db_name].transaction("files", "readwrite");
    let store = transaction.objectStore("files");
    let request = store.clear();

    request.onsuccess = function (event)
    {
        console.log("Data smazány.");
    }
}

/**
 * Converts file to Base64 string.
 *
 * @param {File} file - File to convert.
 * @returns {Promise<string>} - Base64 string.
 */
function Get_base64(file)
{
    const reader = new FileReader();
    return new Promise((resolve) =>
    {
        reader.onload = (event) =>
        {
            resolve(event.target.result)
        };
        reader.readAsDataURL(file);
    });
}

/**
 * Generates settings tab.
 *
 * @param {JSON} json_schema - File content loaded with Read_from_DB().
 */
function Generate_settings_page(json_schema)
{
    let properties = JSON.parse(json_schema.file_content).properties;
    let settings_page = document.getElementById('settings-div');

    Object.keys(properties).forEach((key) =>
    {
        let div = document.createElement('div');
        let label = document.createElement('label');
        label.textContent = properties[key]['title'];
        label.setAttribute('title', properties[key]['description']);
        div.appendChild(label);

        let inner_div = document.createElement('div');

        if (properties[key]['enum'] != null || properties[key]['type'] === 'boolean')
        {
            let select = document.createElement('select');
            select.name = key;
            if (properties[key]['enum'] != null)
            {
                Object.values(properties[key]['enum']).forEach((value) =>
                {
                    let option = document.createElement('option');
                    option.value = value;
                    option.textContent = value;
                    select.appendChild(option);
                });
            }
            else
            {
                let option_true = document.createElement('option');
                option_true.value = "true";
                option_true.textContent = "Yes";
                select.appendChild(option_true);
                let option_false = document.createElement('option');
                option_false.value = "false";
                option_false.textContent = "No";
                select.appendChild(option_false);
            }

            inner_div.appendChild(select);
        }
        else if (properties[key]['type'] === 'string' || properties[key]['type'] === 'num')
        {
            let input = document.createElement('input');
            input.name = key;
            input.type = properties[key]['type'];
            input.appendChild(input);
        }

        div.appendChild(inner_div);
        settings_page.appendChild(div);
    });

    let submit_div = document.createElement('div');
    let button = document.createElement('button');
    button.textContent = "Uložit nastavení";
    button.addEventListener('click', Genrate_settings);
    submit_div.appendChild(button);
    settings_page.appendChild(submit_div);
}

/**
 * Generate abd save user settings.
 */
function Genrate_settings()
{
    let inputs = document.querySelectorAll('#settings-div div div [name]');
    let setting = {};
    for (let element of inputs)
    {
        switch (element.value)
        {
            case "true":
                setting[element.getAttribute('name')] = true;
                break;

            case  "false":
                setting[element.getAttribute('name')] = false;
                break;

            default:
                setting[element.getAttribute('name')] = element.value;
                break;
        }
    }

    window.epub_settings = setting;
    Save_file_to_DB('USER_SETTINGS', JSON.stringify(setting));
}

/**
 * Switches curently displayed tab.
 *
 * @param name - ID of the new tab which should be displayed.
 */
function Display_tab(name)
{
    let active_tab = document.querySelector('[data-display="flex"]');
    if (active_tab.id == name && name != 'epub-display')
    {
        let elements = document.querySelectorAll('[data-display]');
        for (let element of elements)
        {
            element.setAttribute('data-display', 'none');
        }

        document.getElementById('epub-display').setAttribute('data-display', 'flex');
    }
    else if (active_tab.id != name)
    {
        let elements = document.querySelectorAll('[data-display]');
        for (let element of elements)
        {
            element.setAttribute('data-display', 'none');
        }

        document.getElementById(name).setAttribute('data-display', 'flex');
    }
}