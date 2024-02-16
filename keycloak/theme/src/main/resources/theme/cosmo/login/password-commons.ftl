<#macro logoutOtherSessions>
    <div class="${properties.kcFormGroupClass!}">
        <div id="kc-form-options" class="w-full">
            <div class="${properties.kcLabelWrapperClass!}">
                <div class="checkbox">
                    <label>
                        <input type="checkbox" id="logout-sessions" name="logout-sessions" value="on" checked>
                        ${msg("logoutOtherSessions")}
                    </div>
                </div>
            </div>
        </div>
    </div>
</#macro>