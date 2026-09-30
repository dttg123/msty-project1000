package com.dividendos.app;

import static com.google.android.libraries.identity.googleid.GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL;

import android.os.Bundle;
import android.os.CancellationSignal;
import androidx.annotation.NonNull;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

@CapacitorPlugin(name = "NativeGoogleAuth")
public class NativeGoogleAuthPlugin extends Plugin {
    private CredentialManager credentialManager;

    @Override
    public void load() {
        credentialManager = CredentialManager.create(getContext());
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        GetGoogleIdOption googleOption = new GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .setServerClientId(getContext().getString(R.string.default_web_client_id))
            .build();
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(googleOption)
            .build();

        credentialManager.getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    resolveGoogleCredential(call, result.getCredential());
                }

                @Override
                public void onError(@NonNull GetCredentialException error) {
                    if (error instanceof GetCredentialCancellationException) {
                        call.reject("Google 로그인이 취소되었습니다.", "native-auth-cancelled");
                    } else if (error instanceof NoCredentialException) {
                        call.reject("기기에 사용 가능한 Google 계정이 없습니다.", "native-auth-unavailable");
                    } else {
                        call.reject("Google 로그인 설정을 확인해 주세요.", "native-auth-config", error);
                    }
                }
            }
        );
    }

    private void resolveGoogleCredential(PluginCall call, Credential credential) {
        if (!(credential instanceof CustomCredential) || !TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
            call.reject("Google 계정 응답을 확인하지 못했습니다.", "native-auth-unavailable");
            return;
        }
        try {
            Bundle data = ((CustomCredential) credential).getData();
            GoogleIdTokenCredential googleCredential = GoogleIdTokenCredential.createFrom(data);
            JSObject result = new JSObject();
            result.put("idToken", googleCredential.getIdToken());
            result.put("email", googleCredential.getId());
            result.put("displayName", googleCredential.getDisplayName());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Google 로그인 응답을 처리하지 못했습니다.", "native-auth-config", error);
        }
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        credentialManager.clearCredentialStateAsync(
            new ClearCredentialStateRequest(),
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void ignored) { call.resolve(); }

                @Override
                public void onError(@NonNull ClearCredentialException error) {
                    call.reject("Google 계정 상태를 정리하지 못했습니다.", "native-auth-signout", error);
                }
            }
        );
    }
}
