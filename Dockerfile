FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Prog7.slnx ./
COPY src/AudioApi/AudioApi.csproj src/AudioApi/
COPY tests/AudioApi.Tests/AudioApi.Tests.csproj tests/AudioApi.Tests/
RUN dotnet restore src/AudioApi/AudioApi.csproj

COPY . .
RUN dotnet publish src/AudioApi/AudioApi.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish ./

ENV ASPNETCORE_URLS=http://+:8080 \
    ConnectionStrings__Default="Data Source=/app/data/audios.db" \
    Storage__LocalPath=/app/filestore

EXPOSE 8080
ENTRYPOINT ["dotnet", "AudioApi.dll"]
